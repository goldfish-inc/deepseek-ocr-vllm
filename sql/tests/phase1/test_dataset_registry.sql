-- Phase 1: Dataset registry tables exist and enforce uniqueness/foreign keys

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'control' AND table_name = 'dataset_versions'
  ) THEN
    RAISE EXCEPTION 'Missing table control.dataset_versions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'control' AND table_name = 'ingestions'
  ) THEN
    RAISE EXCEPTION 'Missing table control.ingestions';
  END IF;
END$$;

WITH src AS (
  INSERT INTO control.sources (name)
  VALUES ('phase1_dataset_registry_source')
  ON CONFLICT (name) DO UPDATE SET sla_minutes = EXCLUDED.sla_minutes
  RETURNING id
), dv AS (
  INSERT INTO control.dataset_versions (source_id, version, release_date, checksum)
  VALUES ((SELECT id FROM src), 'v2025.01', NOW(), 'checksum-phase1')
  ON CONFLICT (source_id, version) DO UPDATE SET release_date = EXCLUDED.release_date
  RETURNING id
), ingest AS (
  INSERT INTO control.ingestions (dataset_version_id, status, row_count)
  VALUES ((SELECT id FROM dv), 'completed', 1000)
  RETURNING id
)
SELECT 1;

-- Unique constraint guard (duplicate version for same source)
DO $$
DECLARE
  src_id BIGINT;
BEGIN
  SELECT id INTO src_id FROM control.sources WHERE name = 'phase1_dataset_registry_source';
  BEGIN
    INSERT INTO control.dataset_versions (source_id, version)
    VALUES (src_id, 'v2025.01');
    RAISE EXCEPTION 'Duplicate dataset_version allowed unexpectedly';
  EXCEPTION
    WHEN unique_violation THEN
      NULL; -- expected path
  END;
END$$;
