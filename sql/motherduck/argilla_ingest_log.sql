-- Argilla autoload state table (append-only) in md_annotated
-- Tracks which merged Parquet artifacts have been ingested to prevent duplicates

CREATE TABLE IF NOT EXISTS argilla_ingest_log (
  dataset        VARCHAR NOT NULL,
  object_uri     VARCHAR NOT NULL,            -- e.g., s3://…/argilla_records.parquet
  object_etag    VARCHAR,                     -- optional ETag or checksum
  object_bytes   BIGINT,                      -- optional size
  discovered_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ingested_at    TIMESTAMP,
  status         VARCHAR,                     -- discovered|ingesting|ingested|failed
  message        VARCHAR,                     -- last error or info
  PRIMARY KEY (dataset, object_uri)
);
