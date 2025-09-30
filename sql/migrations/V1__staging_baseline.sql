-- V1: Baseline schemas and tables for intelligence staging
-- Idempotent: use IF NOT EXISTS and safe constraints

-- Schemas
create schema if not exists control;
create schema if not exists raw;
create schema if not exists stage;
create schema if not exists label;
create schema if not exists curated;

-- Control tables
create table if not exists control.sources (
  id bigserial primary key,
  name text unique not null,
  sla_minutes int default 1440,
  enabled boolean default true,
  created_at timestamptz default now()
);

create table if not exists control.ingestion_runs (
  id bigserial primary key,
  source_id bigint references control.sources(id) on delete set null,
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text,
  rows_ingested int default 0
);

create table if not exists control.schema_versions (
  id bigserial primary key,
  version text unique not null,
  applied_at timestamptz default now(),
  notes text
);

-- Raw example table (add per-source tables similarly)
create table if not exists raw.vessels_documents (
  id bigserial primary key,
  source text not null,
  source_doc_id text not null,
  fetched_at timestamptz default now(),
  content text,
  content_sha text,
  url text,
  metadata jsonb,
  ingestion_run_id bigint references control.ingestion_runs(id) on delete set null,
  unique (source, source_doc_id)
);
create index if not exists ix_raw_vessels_documents_sha on raw.vessels_documents(content_sha);

-- Stage tables
create table if not exists stage.documents (
  id bigserial primary key,
  source_id bigint references control.sources(id) on delete set null,
  source_doc_id text,
  collected_at timestamptz default now(),
  text text,
  content_sha text,
  metadata jsonb,
  created_at timestamptz default now(),
  unique (source_id, source_doc_id)
);
create index if not exists ix_stage_documents_sha on stage.documents(content_sha);
create index if not exists ix_stage_documents_source on stage.documents(source_id);

create table if not exists stage.extractions (
  id bigserial primary key,
  document_id bigint references stage.documents(id) on delete cascade,
  label text,
  value text,
  start int,
  "end" int,
  confidence double precision,
  db_mapping text, -- e.g., 'curated.vessels.name'
  annotator text,
  updated_at timestamptz default now()
);
create index if not exists ix_stage_extractions_doc on stage.extractions(document_id);

-- Label provenance
create table if not exists label.annotation_refs (
  id bigserial primary key,
  project_id text,
  task_id text,
  hf_repo text,
  path text,
  commit_sha text,
  annotated_at timestamptz,
  schema_version text,
  unique (project_id, task_id, path)
);

-- Curated skeleton
create table if not exists curated.vessels (
  vessel_id bigserial primary key,
  imo text,
  mmsi text,
  name text,
  flag text,
  updated_at timestamptz default now()
);

create table if not exists curated.vessel_info (
  vessel_id bigint references curated.vessels(vessel_id) on delete cascade,
  key text,
  value text,
  updated_at timestamptz default now()
);

create table if not exists curated.entity_persons (
  person_id bigserial primary key,
  name text,
  role text,
  updated_at timestamptz default now()
);

create table if not exists curated.entity_organizations (
  org_id bigserial primary key,
  name text,
  updated_at timestamptz default now()
);

