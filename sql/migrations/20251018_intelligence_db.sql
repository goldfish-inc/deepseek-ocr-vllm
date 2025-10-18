-- Intelligence DB schema (versioned records with lineage)

create table if not exists documents (
  id bigserial primary key,
  s3_key text not null,
  sha256 text not null,
  content_type text,
  source text,
  created_at timestamptz not null default now(),
  unique (s3_key, sha256)
);

create table if not exists records (
  id bigserial primary key,
  document_id bigint not null references documents(id) on delete cascade,
  doc_type text not null,           -- csv, pdf, image, text
  record_index integer default 0,   -- row index for csv/table rows
  current_version integer default 0,
  created_at timestamptz not null default now(),
  unique (document_id, doc_type, record_index)
);

create table if not exists record_versions (
  id bigserial primary key,
  record_id bigint not null references records(id) on delete cascade,
  version integer not null,
  data jsonb not null default '{}',      -- canonical fields map
  spans jsonb not null default '[]',     -- LS-style spans for audit
  model_version text,                    -- from VERSION.json or adapter
  ls_project_id bigint,
  ls_task_id bigint,
  ls_annotation_id bigint,
  created_by text,                       -- LS user or service
  created_at timestamptz not null default now(),
  unique (record_id, version)
);

create index if not exists idx_records_doc on records(document_id);
create index if not exists idx_versions_record on record_versions(record_id);

create table if not exists annotations (
  id bigserial primary key,
  ls_project_id bigint not null,
  ls_task_id bigint not null,
  ls_annotation_id bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (ls_project_id, ls_task_id, ls_annotation_id)
);
