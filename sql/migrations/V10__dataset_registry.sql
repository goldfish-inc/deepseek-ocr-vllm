-- V10: Dataset registry and ingestion lineage
-- Purpose: Provide consistent provenance tables for public dataset releases.

BEGIN;

CREATE TABLE IF NOT EXISTS control.dataset_versions (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES control.sources(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  release_date TIMESTAMPTZ,
  checksum TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_id, version)
);

CREATE INDEX IF NOT EXISTS ix_dataset_versions_source
  ON control.dataset_versions (source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS control.ingestions (
  id BIGSERIAL PRIMARY KEY,
  dataset_version_id BIGINT NOT NULL REFERENCES control.dataset_versions(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT,
  row_count BIGINT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_ingestions_dataset_version
  ON control.ingestions (dataset_version_id, created_at DESC);

-- Stage tables capture ingestion linkage for provenance
ALTER TABLE stage.documents
  ADD COLUMN IF NOT EXISTS dataset_version_id BIGINT,
  ADD COLUMN IF NOT EXISTS ingestion_id BIGINT;

ALTER TABLE stage.csv_extractions
  ADD COLUMN IF NOT EXISTS dataset_version_id BIGINT,
  ADD COLUMN IF NOT EXISTS ingestion_id BIGINT;

ALTER TABLE stage.document_processing_log
  ADD COLUMN IF NOT EXISTS dataset_version_id BIGINT,
  ADD COLUMN IF NOT EXISTS ingestion_id BIGINT;

CREATE INDEX IF NOT EXISTS ix_stage_documents_ingestion
  ON stage.documents (ingestion_id);

CREATE INDEX IF NOT EXISTS ix_stage_csv_extractions_ingestion
  ON stage.csv_extractions (ingestion_id);

CREATE INDEX IF NOT EXISTS ix_stage_doc_processing_ingestion
  ON stage.document_processing_log (ingestion_id);

-- Apply foreign keys to curated tables where lineage columns exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vessel_identifiers_dataset_version'
  ) THEN
    ALTER TABLE curated.vessel_identifiers
      ADD CONSTRAINT fk_vessel_identifiers_dataset_version
      FOREIGN KEY (dataset_version_id)
      REFERENCES control.dataset_versions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vessel_identifiers_ingestion'
  ) THEN
    ALTER TABLE curated.vessel_identifiers
      ADD CONSTRAINT fk_vessel_identifiers_ingestion
      FOREIGN KEY (ingestion_id)
      REFERENCES control.ingestions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vessel_info_dataset_version'
  ) THEN
    ALTER TABLE curated.vessel_info_typed
      ADD CONSTRAINT fk_vessel_info_dataset_version
      FOREIGN KEY (dataset_version_id)
      REFERENCES control.dataset_versions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vessel_info_ingestion'
  ) THEN
    ALTER TABLE curated.vessel_info_typed
      ADD CONSTRAINT fk_vessel_info_ingestion
      FOREIGN KEY (ingestion_id)
      REFERENCES control.ingestions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vessel_associates_dataset_version'
  ) THEN
    ALTER TABLE curated.vessel_associates
      ADD CONSTRAINT fk_vessel_associates_dataset_version
      FOREIGN KEY (dataset_version_id)
      REFERENCES control.dataset_versions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vessel_associates_ingestion'
  ) THEN
    ALTER TABLE curated.vessel_associates
      ADD CONSTRAINT fk_vessel_associates_ingestion
      FOREIGN KEY (ingestion_id)
      REFERENCES control.ingestions(id)
      ON DELETE SET NULL;
  END IF;
END$$;

-- Stage table foreign keys (optional provenance; set null on delete)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_stage_documents_dataset_version'
  ) THEN
    ALTER TABLE stage.documents
      ADD CONSTRAINT fk_stage_documents_dataset_version
      FOREIGN KEY (dataset_version_id)
      REFERENCES control.dataset_versions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_stage_documents_ingestion'
  ) THEN
    ALTER TABLE stage.documents
      ADD CONSTRAINT fk_stage_documents_ingestion
      FOREIGN KEY (ingestion_id)
      REFERENCES control.ingestions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_stage_csv_extractions_dataset_version'
  ) THEN
    ALTER TABLE stage.csv_extractions
      ADD CONSTRAINT fk_stage_csv_extractions_dataset_version
      FOREIGN KEY (dataset_version_id)
      REFERENCES control.dataset_versions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_stage_csv_extractions_ingestion'
  ) THEN
    ALTER TABLE stage.csv_extractions
      ADD CONSTRAINT fk_stage_csv_extractions_ingestion
      FOREIGN KEY (ingestion_id)
      REFERENCES control.ingestions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_stage_doc_processing_dataset_version'
  ) THEN
    ALTER TABLE stage.document_processing_log
      ADD CONSTRAINT fk_stage_doc_processing_dataset_version
      FOREIGN KEY (dataset_version_id)
      REFERENCES control.dataset_versions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_stage_doc_processing_ingestion'
  ) THEN
    ALTER TABLE stage.document_processing_log
      ADD CONSTRAINT fk_stage_doc_processing_ingestion
      FOREIGN KEY (ingestion_id)
      REFERENCES control.ingestions(id)
      ON DELETE SET NULL;
  END IF;
END$$;

COMMENT ON TABLE control.dataset_versions IS 'Versioned releases of public datasets, linked to control.sources.';
COMMENT ON TABLE control.ingestions IS 'Individual ingestion executions tied to dataset versions (auditable provenance).';

COMMIT;
