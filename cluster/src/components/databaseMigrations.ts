import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as fs from "fs";
import * as path from "path";

export interface DatabaseMigrationsArgs {
  k8sProvider: k8s.Provider;
  namespace?: string;
  dbUrl: pulumi.Input<string>;
  migrationsPath?: string;
  enableSeedData?: boolean;
}

export interface MigrationDefinition {
  name: string;
  file: string;
  description: string;
  dependsOn?: string[];
}

export class DatabaseMigrations extends pulumi.ComponentResource {
  public readonly migrationStatus: pulumi.Output<{
    applied: string[];
    pending: string[];
    failed: string[];
  }>;

  private readonly migrations: MigrationDefinition[] = [
    {
      name: "V3",
      file: "V3__staging_tables_complete.sql",
      description: "5 staging tables for ML-powered CSV cleaning pipeline",
      dependsOn: [],
    },
    {
      name: "V4",
      file: "V4__curated_reference_tables.sql",
      description: "Reference tables (13 RFMOs, gear types, vessel types)",
      dependsOn: ["V3"],
    },
    {
      name: "V5",
      file: "V5__curated_temporal_events.sql",
      description: "Temporal event tables for vessel history tracking",
      dependsOn: ["V4"],
    },
    {
      name: "V6",
      file: "V6__vessel_info_typed_columns.sql",
      description: "Typed vessel_info columns (move from EAV to typed)",
      dependsOn: ["V5"],
    },
  ];

  constructor(
    name: string,
    args: DatabaseMigrationsArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("oceanid:db:DatabaseMigrations", name, {}, opts);

    const {
      k8sProvider,
      namespace = "default",
      dbUrl,
      migrationsPath = "../sql/migrations",
      enableSeedData = true,
    } = args;

    const appliedMigrations: string[] = [];
    const pendingMigrations: string[] = [];
    const failedMigrations: string[] = [];

    // Track migration jobs for dependency management
    const migrationJobs: Record<string, k8s.batch.v1.Job> = {};

    // Apply each migration in sequence
    for (const migration of this.migrations) {
      const migrationName = `${name}-${migration.name.toLowerCase()}`;

      // Read migration SQL file
      const migrationFilePath = path.resolve(
        __dirname,
        migrationsPath,
        migration.file
      );

      let migrationSql: string;
      try {
        migrationSql = fs.readFileSync(migrationFilePath, "utf-8");
      } catch (error) {
        console.warn(
          `⚠️  Migration file not found: ${migration.file} (${migrationFilePath})`
        );
        pendingMigrations.push(migration.name);
        continue;
      }

      // Create ConfigMap with migration SQL
      const sqlConfigMap = new k8s.core.v1.ConfigMap(
        `${migrationName}-sql`,
        {
          metadata: {
            name: `${migrationName}-sql`,
            namespace,
            labels: {
              "app.kubernetes.io/name": "database-migrations",
              "app.kubernetes.io/component": "migration",
              "migration.oceanid.io/version": migration.name,
            },
          },
          data: {
            "migration.sql": migrationSql,
          },
        },
        { provider: k8sProvider, parent: this }
      );

      // Determine dependencies
      const jobDependencies: pulumi.Resource[] = [sqlConfigMap];
      if (migration.dependsOn) {
        for (const depName of migration.dependsOn) {
          const depJob = migrationJobs[depName];
          if (depJob) {
            jobDependencies.push(depJob);
          }
        }
      }

      // Create Kubernetes Job to apply migration
      const migrationJob = new k8s.batch.v1.Job(
        `${migrationName}-job`,
        {
          metadata: {
            name: `${migrationName}-job`,
            namespace,
            labels: {
              "app.kubernetes.io/name": "database-migrations",
              "app.kubernetes.io/component": "migration",
              "migration.oceanid.io/version": migration.name,
            },
            annotations: {
              "migration.oceanid.io/description": migration.description,
              "migration.oceanid.io/file": migration.file,
            },
          },
          spec: {
            backoffLimit: 3,
            activeDeadlineSeconds: 600, // 10 minute timeout
            ttlSecondsAfterFinished: 86400, // Keep for 24 hours
            template: {
              metadata: {
                labels: {
                  "app.kubernetes.io/name": "database-migrations",
                  "migration.oceanid.io/version": migration.name,
                },
              },
              spec: {
                restartPolicy: "OnFailure",
                volumes: [
                  {
                    name: "migration-sql",
                    configMap: { name: sqlConfigMap.metadata.name },
                  },
                ],
                containers: [
                  {
                    name: "psql",
                    image: "postgres:17",
                    env: [{ name: "DATABASE_URL", value: dbUrl as any }],
                    volumeMounts: [
                      { name: "migration-sql", mountPath: "/migrations" },
                    ],
                    command: ["bash", "-c"],
                    args: [
                      `
                      set -e
                      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                      echo "🔄 Applying migration: ${migration.name}"
                      echo "📄 File: ${migration.file}"
                      echo "📝 ${migration.description}"
                      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

                      # Wait for database to be ready
                      echo "⏳ Waiting for database connection..."
                      until pg_isready -d "$DATABASE_URL" -q; do
                        echo "   Database not ready, retrying in 2s..."
                        sleep 2
                      done
                      echo "✅ Database connection established"

                      # Check if migration already applied
                      echo ""
                      echo "🔍 Checking if migration already applied..."
                      MIGRATION_EXISTS=$(psql "$DATABASE_URL" -tAc "
                        SELECT EXISTS (
                          SELECT 1 FROM information_schema.schemata
                          WHERE schema_name = 'control'
                        ) AND EXISTS (
                          SELECT 1 FROM information_schema.tables
                          WHERE table_schema = 'control'
                          AND table_name = 'schema_versions'
                        ) AND EXISTS (
                          SELECT 1 FROM control.schema_versions
                          WHERE domain = '${migration.name}'
                        );
                      " || echo "false")

                      if [ "$MIGRATION_EXISTS" = "t" ]; then
                        echo "⏭️  Migration ${migration.name} already applied, skipping..."
                        exit 0
                      fi

                      # Apply migration
                      echo ""
                      echo "▶️  Applying migration SQL..."
                      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/migration.sql

                      # Record migration in control.schema_versions
                      echo ""
                      echo "📝 Recording migration in control.schema_versions..."
                      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
                        INSERT INTO control.schema_versions (domain, version, activated_at)
                        VALUES ('${migration.name}', '${migration.file}', now())
                        ON CONFLICT (domain) DO UPDATE
                          SET version = EXCLUDED.version,
                              activated_at = EXCLUDED.activated_at;
SQL

                      echo ""
                      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                      echo "✅ Migration ${migration.name} completed successfully!"
                      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                      `,
                    ],
                  },
                ],
              },
            },
          },
        },
        {
          provider: k8sProvider,
          parent: this,
          dependsOn: jobDependencies,
        }
      );

      migrationJobs[migration.name] = migrationJob;
      appliedMigrations.push(migration.name);
    }

    // Load seed data if enabled
    if (enableSeedData) {
      const seedFiles = [
        {
          name: "cleaning-rules",
          file: "seed_cleaning_rules.sql",
          description: "5000+ cleaning rules extracted from pandas scripts",
          dependsOn: ["V3"], // Requires stage.cleaning_rules table
        },
      ];

      for (const seed of seedFiles) {
        const seedName = `${name}-seed-${seed.name}`;
        const seedFilePath = path.resolve(
          __dirname,
          migrationsPath,
          seed.file
        );

        let seedSql: string;
        try {
          seedSql = fs.readFileSync(seedFilePath, "utf-8");
        } catch (error) {
          console.warn(`⚠️  Seed file not found: ${seed.file}`);
          continue;
        }

        const seedConfigMap = new k8s.core.v1.ConfigMap(
          `${seedName}-sql`,
          {
            metadata: {
              name: `${seedName}-sql`,
              namespace,
              labels: {
                "app.kubernetes.io/name": "database-migrations",
                "app.kubernetes.io/component": "seed-data",
              },
            },
            data: { "seed.sql": seedSql },
          },
          { provider: k8sProvider, parent: this }
        );

        // Determine seed dependencies
        const seedDependencies: pulumi.Resource[] = [seedConfigMap];
        if (seed.dependsOn) {
          for (const depName of seed.dependsOn) {
            const depJob = migrationJobs[depName];
            if (depJob) {
              seedDependencies.push(depJob);
            }
          }
        }

        new k8s.batch.v1.Job(
          `${seedName}-job`,
          {
            metadata: {
              name: `${seedName}-job`,
              namespace,
              labels: {
                "app.kubernetes.io/name": "database-migrations",
                "app.kubernetes.io/component": "seed-data",
              },
              annotations: {
                "seed.oceanid.io/description": seed.description,
              },
            },
            spec: {
              backoffLimit: 2,
              activeDeadlineSeconds: 1800, // 30 minute timeout for large seed files
              ttlSecondsAfterFinished: 86400,
              template: {
                metadata: {
                  labels: {
                    "app.kubernetes.io/name": "database-migrations",
                    "app.kubernetes.io/component": "seed-data",
                  },
                },
                spec: {
                  restartPolicy: "OnFailure",
                  volumes: [
                    {
                      name: "seed-sql",
                      configMap: { name: seedConfigMap.metadata.name },
                    },
                  ],
                  containers: [
                    {
                      name: "psql",
                      image: "postgres:17",
                      env: [{ name: "DATABASE_URL", value: dbUrl as any }],
                      volumeMounts: [
                        { name: "seed-sql", mountPath: "/seed" },
                      ],
                      command: ["bash", "-c"],
                      args: [
                        `
                        set -e
                        echo "🌱 Loading seed data: ${seed.name}"
                        echo "📄 File: ${seed.file}"

                        until pg_isready -d "$DATABASE_URL" -q; do
                          sleep 2
                        done

                        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /seed/seed.sql

                        echo "✅ Seed data loaded successfully"
                        `,
                      ],
                    },
                  ],
                },
              },
            },
          },
          {
            provider: k8sProvider,
            parent: this,
            dependsOn: seedDependencies,
          }
        );
      }
    }

    // Create migration status output
    this.migrationStatus = pulumi.output({
      applied: appliedMigrations,
      pending: pendingMigrations,
      failed: failedMigrations,
    });

    this.registerOutputs({
      migrationStatus: this.migrationStatus,
    });
  }
}
