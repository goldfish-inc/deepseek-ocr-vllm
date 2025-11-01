-- V8: Curated core entities (maritime)
-- Purpose: Harden curated schema for maritime intelligence with canonical entities,
--          identifier management, typed attribute storage, and associate tracking.
--          Designed to align with ADR-001 (temporal + provenance model).

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Ensure previous unique indexes from earlier revisions do not conflict
DROP INDEX IF EXISTS curated.ux_vessels_imo_unique;
DROP INDEX IF EXISTS curated.ux_vessels_mmsi_unique;
DROP INDEX IF EXISTS curated.ux_vessels_ircs_unique;

-- ---------------------------------------------------------------------------
-- curated.vessels (canonical entity)
-- ---------------------------------------------------------------------------

ALTER TABLE curated.vessels
  ADD COLUMN IF NOT EXISTS imo TEXT,
  ADD COLUMN IF NOT EXISTS mmsi TEXT,
  ADD COLUMN IF NOT EXISTS ircs TEXT,
  ADD COLUMN IF NOT EXISTS call_sign TEXT,
  ADD COLUMN IF NOT EXISTS vessel_name TEXT,
  ADD COLUMN IF NOT EXISTS flag_code TEXT,
  ADD COLUMN IF NOT EXISTS vessel_type TEXT,
  ADD COLUMN IF NOT EXISTS build_year INTEGER,
  ADD COLUMN IF NOT EXISTS risk_level TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_vessels_imo'
  ) THEN
    ALTER TABLE curated.vessels
      ADD CONSTRAINT uq_vessels_imo UNIQUE (imo);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_vessels_mmsi'
  ) THEN
    ALTER TABLE curated.vessels
      ADD CONSTRAINT uq_vessels_mmsi UNIQUE (mmsi);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_vessels_ircs'
  ) THEN
    ALTER TABLE curated.vessels
      ADD CONSTRAINT uq_vessels_ircs UNIQUE (ircs);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_vessels_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION curated.set_vessels_updated_at()
    RETURNS trigger AS $func$
    BEGIN
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_vessels_updated_at
      BEFORE UPDATE ON curated.vessels
      FOR EACH ROW
      EXECUTE FUNCTION curated.set_vessels_updated_at();
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- curated.vessel_identifiers (temporal identifiers linked to canonical vessel)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS curated.vessel_identifiers (
  id BIGSERIAL PRIMARY KEY,
  vessel_id BIGINT NOT NULL REFERENCES curated.vessels(vessel_id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  confidence NUMERIC(5,4) DEFAULT 1.0,
  dataset_version_id BIGINT,
  ingestion_id BIGINT,
  metadata JSONB DEFAULT '{}'::JSONB
);

ALTER TABLE curated.vessel_identifiers
  ADD COLUMN IF NOT EXISTS dataset_version_id BIGINT;
ALTER TABLE curated.vessel_identifiers
  ADD COLUMN IF NOT EXISTS ingestion_id BIGINT;
ALTER TABLE curated.vessel_identifiers
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB;

DROP INDEX IF EXISTS curated.ux_vessel_identifiers_unique_period;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_vessel_identifiers_value'
  ) THEN
    ALTER TABLE curated.vessel_identifiers
      ADD CONSTRAINT uq_vessel_identifiers_value
      UNIQUE (identifier_type, identifier_value);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_vessel_identifiers_lookup
  ON curated.vessel_identifiers (identifier_type, identifier_value);

CREATE INDEX IF NOT EXISTS ix_vessel_identifiers_valid_period
  ON curated.vessel_identifiers USING GIST (
    tstzrange(COALESCE(valid_from, '-infinity'::TIMESTAMPTZ),
              COALESCE(valid_to, 'infinity'::TIMESTAMPTZ))
  );

-- ---------------------------------------------------------------------------
-- curated.vessel_info_typed (typed hot fields per vessel)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS curated.vessel_info_typed (
  vessel_id BIGINT PRIMARY KEY REFERENCES curated.vessels(vessel_id) ON DELETE CASCADE,
  dataset_version_id BIGINT,
  ingestion_id BIGINT,
  flag_code TEXT,
  vessel_type TEXT,
  build_year INTEGER,
  gross_tonnage NUMERIC(12,2),
  displacement NUMERIC(12,2),
  length_overall NUMERIC(10,2),
  beam NUMERIC(10,2),
  draught NUMERIC(10,2),
  engine_power_kw NUMERIC(12,2),
  risk_level TEXT,
  source_confidence NUMERIC(5,4),
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE curated.vessel_info_typed
  ADD COLUMN IF NOT EXISTS dataset_version_id BIGINT;
ALTER TABLE curated.vessel_info_typed
  ADD COLUMN IF NOT EXISTS ingestion_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_vessel_info_typed_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION curated.set_vessel_info_updated_at()
    RETURNS trigger AS $func2$
    BEGIN
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $func2$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_vessel_info_typed_updated_at
      BEFORE UPDATE ON curated.vessel_info_typed
      FOR EACH ROW
      EXECUTE FUNCTION curated.set_vessel_info_updated_at();
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- curated.vessel_associates (owners/operators/crew etc.)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS curated.vessel_associates (
  id BIGSERIAL PRIMARY KEY,
  vessel_id BIGINT NOT NULL REFERENCES curated.vessels(vessel_id) ON DELETE CASCADE,
  associate_type TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  role TEXT,
  jurisdiction TEXT,
  contact_details JSONB,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  confidence NUMERIC(5,4) DEFAULT 1.0,
  dataset_version_id BIGINT,
  ingestion_id BIGINT,
  metadata JSONB DEFAULT '{}'::JSONB
);

ALTER TABLE curated.vessel_associates
  ADD COLUMN IF NOT EXISTS entity_name TEXT,
  ADD COLUMN IF NOT EXISTS jurisdiction TEXT,
  ADD COLUMN IF NOT EXISTS contact_details JSONB,
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS dataset_version_id BIGINT,
  ADD COLUMN IF NOT EXISTS ingestion_id BIGINT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB;

-- Drop V5 XOR constraints (incompatible with V8 entity_name model)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vessel_associates_check'
  ) THEN
    ALTER TABLE curated.vessel_associates DROP CONSTRAINT vessel_associates_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vessel_associates_check1'
  ) THEN
    ALTER TABLE curated.vessel_associates DROP CONSTRAINT vessel_associates_check1;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_vessel_associates_vessel
  ON curated.vessel_associates (vessel_id);

CREATE INDEX IF NOT EXISTS ix_vessel_associates_type
  ON curated.vessel_associates (associate_type, entity_name);

CREATE INDEX IF NOT EXISTS ix_vessel_associates_valid_period
  ON curated.vessel_associates USING GIST (
    daterange(COALESCE(valid_from::DATE, '-infinity'::DATE),
              COALESCE(valid_to::DATE, 'infinity'::DATE))
  );

COMMENT ON TABLE curated.vessel_identifiers IS 'Temporal vessel identifiers mapped to canonical vessels with provenance metadata.';
COMMENT ON COLUMN curated.vessel_identifiers.identifier_type IS 'Identifier class (IMO, MMSI, IRCS, CALL_SIGN, INTERNAL, etc.).';
COMMENT ON COLUMN curated.vessel_identifiers.dataset_version_id IS 'References control.dataset_versions once V10 applies foreign key.';

COMMENT ON TABLE curated.vessel_info_typed IS 'Typed “hot” attributes for vessels, complementing the long-tail assertions table.';
COMMENT ON COLUMN curated.vessel_info_typed.dataset_version_id IS 'References control.dataset_versions once V10 applies foreign key.';

COMMENT ON TABLE curated.vessel_associates IS 'Associations between vessels and people/organizations with validity windows and provenance.';

COMMIT;
