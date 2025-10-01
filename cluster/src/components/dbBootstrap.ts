import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface DbBootstrapArgs {
  k8sProvider: k8s.Provider;
  namespace?: string;
  dbUrl: pulumi.Input<string>;
}

export class DbBootstrap extends pulumi.ComponentResource {
  constructor(name: string, args: DbBootstrapArgs, opts?: pulumi.ComponentResourceOptions) {
    super("oceanid:db:Bootstrap", name, {}, opts);

    const { k8sProvider, namespace = "apps", dbUrl } = args;

    const sql = `
create schema if not exists control;
create schema if not exists raw;
create schema if not exists stage;
create schema if not exists label;
create schema if not exists curated;

create table if not exists control.sources(
  id bigserial primary key,
  name text unique not null,
  owner text,
  sla_minutes int,
  enabled boolean default true,
  created_at timestamptz default now()
);

create table if not exists control.ingestion_runs(
  id bigserial primary key,
  source_id bigint references control.sources(id),
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text,
  note text
);

create table if not exists control.schema_versions(
  domain text primary key,
  version text not null,
  activated_at timestamptz default now()
);

create table if not exists stage.documents(
  id bigserial primary key,
  source_id bigint,
  source_doc_id text,
  collected_at timestamptz default now(),
  text text,
  content_sha bytea,
  metadata jsonb,
  unique(source_id, source_doc_id)
);
create index if not exists ix_stage_documents_collected_at on stage.documents(collected_at);

create table if not exists stage.extractions(
  id bigserial primary key,
  document_id bigint references stage.documents(id) on delete cascade,
  label text,
  value text,
  start int,
  "end" int,
  confidence double precision,
  db_mapping text,
  annotator text,
  updated_at timestamptz default now()
);
create index if not exists ix_stage_extractions_doc on stage.extractions(document_id);
`;

    const cfg = new k8s.core.v1.ConfigMap(`${name}-sql`, {
      metadata: { name: `${name}-sql`, namespace },
      data: { "init.sql": sql },
    }, { provider: k8sProvider, parent: this });

    const job = new k8s.batch.v1.Job(`${name}-job`, {
      metadata: { name: `${name}-job`, namespace },
      spec: {
        backoffLimit: 2,
        template: {
          metadata: { labels: { app: `${name}-job` } },
          spec: {
            restartPolicy: "OnFailure",
            volumes: [{ name: "sql", configMap: { name: cfg.metadata.name } }],
            containers: [{
              name: "psql",
              image: "postgres:17",
              env: [{ name: "DATABASE_URL", value: dbUrl as any }],
              volumeMounts: [{ name: "sql", mountPath: "/sql" }],
              command: ["bash", "-lc"],
              args: [
                "until pg_isready -d \"$DATABASE_URL\" -q; do echo waiting for db; sleep 2; done; psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f /sql/init.sql"
              ],
            }],
          },
        },
      },
    }, { provider: k8sProvider, parent: this, dependsOn: [cfg] });

    this.registerOutputs({});
  }
}
