import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface PostgresDatabaseArgs {
  /**
   * Admin connection URL (superuser with CREATEDB privilege)
   */
  adminUrl: pulumi.Input<string>;

  /**
   * Database name to create
   */
  databaseName: string;

  /**
   * Owner role name
   */
  ownerRole: string;

  /**
   * Owner password
   */
  ownerPassword: pulumi.Input<string>;

  /**
   * Path to bootstrap SQL file
   */
  bootstrapSqlPath: string;
}

export interface PostgresDatabaseOutputs {
  /**
   * Connection URL for the database
   */
  connectionUrl: pulumi.Output<string>;

  /**
   * Database creation status
   */
  ready: pulumi.Output<boolean>;
}

/**
 * PostgreSQL Database
 *
 * Creates a database within an existing PostgreSQL cluster and runs bootstrap SQL.
 * Uses psql commands via command.local.Command for IaC-managed database provisioning.
 */
export class PostgresDatabase extends pulumi.ComponentResource {
  public readonly outputs: PostgresDatabaseOutputs;

  constructor(
    name: string,
    args: PostgresDatabaseArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("oceanid:db:PostgresDatabase", name, {}, opts);

    const path = require("path");
    const fs = require("fs");

    // Resolve SQL file path relative to repo root (../../ from cloud/dist/)
    const sqlPath = path.resolve(__dirname, "..", "..", "..", args.bootstrapSqlPath);
    const bootstrapSql = fs.readFileSync(sqlPath, "utf8");

    // Extract host from admin URL for connection URL output
    const host = pulumi.output(args.adminUrl).apply((url) => {
      const match = url.match(/@([^:\/]+)/);
      return match ? match[1] : "";
    });

    // Apply bootstrap SQL to existing database
    // NOTE: Database must be created manually first via: cb psql <cluster-id> --role postgres -- -c "CREATE DATABASE <name>;"
    // This only applies schema/roles/extensions/grants (idempotent)
    const provision = new command.local.Command(
      `${name}-provision`,
      {
        create: pulumi.all([args.adminUrl, args.ownerPassword]).apply(([adminUrl, ownerPass]) => {
          const dbUrl = adminUrl.replace("/postgres", `/${args.databaseName}`);
          return `psql "${dbUrl}" -v ON_ERROR_STOP=1 <<'OUTER'
-- Bootstrap SQL (idempotent - all commands use IF NOT EXISTS or idempotent patterns)
${bootstrapSql}

-- Set owner password (idempotent)
ALTER ROLE ${args.ownerRole} WITH PASSWORD '${ownerPass}';
OUTER`;
        }),
      },
      { parent: this }
    );

    this.outputs = {
      connectionUrl: pulumi.secret(
        pulumi.interpolate`postgres://${args.ownerRole}:${args.ownerPassword}@${host}:5432/${args.databaseName}`
      ),
      ready: pulumi.output(true).apply(() => true),
    };

    this.registerOutputs({
      connectionUrl: this.outputs.connectionUrl,
      ready: this.outputs.ready,
    });
  }
}
