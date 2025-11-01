-- V11: Temporal attribute assertions and vessel events
-- Purpose: Capture long-tail attributes and watchlist events with validity windows
--          and provenance links back to dataset versions, ingestions, and documents.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS curated.vessel_attribute_assertions (
  assertion_id BIGSERIAL PRIMARY KEY,
  vessel_id BIGINT NOT NULL REFERENCES curated.vessels(vessel_id) ON DELETE CASCADE,
  attribute TEXT NOT NULL,
  value_json JSONB NOT NULL,
  value_text TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  confidence NUMERIC(5,4) DEFAULT 1.0,
  dataset_version_id BIGINT,
  ingestion_id BIGINT,
  document_id BIGINT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ck_attribute_valid_period
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

ALTER TABLE curated.vessel_attribute_assertions
  ADD COLUMN IF NOT EXISTS dataset_version_id BIGINT,
  ADD COLUMN IF NOT EXISTS ingestion_id BIGINT,
  ADD COLUMN IF NOT EXISTS document_id BIGINT;

CREATE INDEX IF NOT EXISTS ix_vessel_attribute_attr
  ON curated.vessel_attribute_assertions (attribute);

CREATE INDEX IF NOT EXISTS ix_vessel_attribute_vessel
  ON curated.vessel_attribute_assertions (vessel_id);

CREATE INDEX IF NOT EXISTS ix_vessel_attribute_valid_period
  ON curated.vessel_attribute_assertions USING GIST (
    tstzrange(COALESCE(valid_from, '-infinity'::TIMESTAMPTZ),
              COALESCE(valid_to, 'infinity'::TIMESTAMPTZ))
  );

-- Watchlist / sanctions style events
CREATE TABLE IF NOT EXISTS curated.vessel_watchlist_events (
  event_id BIGSERIAL PRIMARY KEY,
  vessel_id BIGINT NOT NULL REFERENCES curated.vessels(vessel_id) ON DELETE CASCADE,
  list_name TEXT NOT NULL,
  jurisdiction TEXT,
  status TEXT NOT NULL DEFAULT 'active',     -- active / cleared / pending
  reason TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  dataset_version_id BIGINT,
  ingestion_id BIGINT,
  document_id BIGINT,
  notes TEXT,
  CONSTRAINT ck_watchlist_valid_period
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

ALTER TABLE curated.vessel_watchlist_events
  ADD COLUMN IF NOT EXISTS dataset_version_id BIGINT,
  ADD COLUMN IF NOT EXISTS ingestion_id BIGINT,
  ADD COLUMN IF NOT EXISTS document_id BIGINT;

CREATE INDEX IF NOT EXISTS ix_watchlist_events_vessel
  ON curated.vessel_watchlist_events (vessel_id, list_name);

CREATE INDEX IF NOT EXISTS ix_watchlist_events_valid_period
  ON curated.vessel_watchlist_events USING GIST (
    tstzrange(COALESCE(valid_from, '-infinity'::TIMESTAMPTZ),
              COALESCE(valid_to, 'infinity'::TIMESTAMPTZ))
  );

-- Stage documents provide primary key for provenance when available
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vessel_attribute_dataset_version'
  ) THEN
    ALTER TABLE curated.vessel_attribute_assertions
      ADD CONSTRAINT fk_vessel_attribute_dataset_version
      FOREIGN KEY (dataset_version_id)
      REFERENCES control.dataset_versions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vessel_attribute_ingestion'
  ) THEN
    ALTER TABLE curated.vessel_attribute_assertions
      ADD CONSTRAINT fk_vessel_attribute_ingestion
      FOREIGN KEY (ingestion_id)
      REFERENCES control.ingestions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_vessel_attribute_document'
  ) THEN
    ALTER TABLE curated.vessel_attribute_assertions
      ADD CONSTRAINT fk_vessel_attribute_document
      FOREIGN KEY (document_id)
      REFERENCES stage.documents(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_watchlist_events_dataset_version'
  ) THEN
    ALTER TABLE curated.vessel_watchlist_events
      ADD CONSTRAINT fk_watchlist_events_dataset_version
      FOREIGN KEY (dataset_version_id)
      REFERENCES control.dataset_versions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_watchlist_events_ingestion'
  ) THEN
    ALTER TABLE curated.vessel_watchlist_events
      ADD CONSTRAINT fk_watchlist_events_ingestion
      FOREIGN KEY (ingestion_id)
      REFERENCES control.ingestions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_watchlist_events_document'
  ) THEN
    ALTER TABLE curated.vessel_watchlist_events
      ADD CONSTRAINT fk_watchlist_events_document
      FOREIGN KEY (document_id)
      REFERENCES stage.documents(id)
      ON DELETE SET NULL;
  END IF;
END$$;

COMMENT ON TABLE curated.vessel_attribute_assertions IS 'Temporal attribute assertions for vessels (long-tail facts with provenance).';
COMMENT ON TABLE curated.vessel_watchlist_events IS 'Watchlist / sanctions events captured with validity windows and provenance.';

COMMIT;
