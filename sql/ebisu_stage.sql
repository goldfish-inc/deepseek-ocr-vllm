-- Stage schema for batch loads into EBISU pipeline
\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS stage;
CREATE SCHEMA IF NOT EXISTS ebisu;

-- Track load batches
CREATE TABLE IF NOT EXISTS stage.load_batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loaded_at timestamptz NOT NULL DEFAULT now(),
  source TEXT,
  artifact_checksum TEXT,
  notes TEXT
);

-- Landing table for vessel rows from Parquet (schema-on-read; preserve columns)
-- Columns are created by CTAS; we add batch metadata afterwards
-- The loader will create/replace this table and then set columns below.

COMMIT;
