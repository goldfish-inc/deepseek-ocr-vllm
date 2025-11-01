-- V7: Stage contract alignment (fold emergency patch)
-- Purpose: Consolidate emergency fixes into migrations and finalize stage.* worker contracts.
-- Safe/idempotent: uses conditional checks to avoid errors if columns already exist.

BEGIN;

-- stage.cleaning_rules alignment
-- Ensure scalar columns used by workers exist, and provide a stable is_active flag.
DO $$
BEGIN
  -- column_name used to scope rules to a single column when needed
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='cleaning_rules' AND column_name='column_name'
  ) THEN
    ALTER TABLE stage.cleaning_rules ADD COLUMN column_name TEXT;
  END IF;

  -- Some environments used 'enabled', others 'active'. Add a generated alias where missing.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='cleaning_rules' AND column_name='active'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='cleaning_rules' AND column_name='enabled'
  ) THEN
    ALTER TABLE stage.cleaning_rules
      ADD COLUMN active BOOLEAN GENERATED ALWAYS AS (enabled) STORED;
  END IF;

  -- Provide a canonical is_active column for workers to read
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='cleaning_rules' AND column_name='is_active'
  ) THEN
    -- If both active and enabled exist, prefer active; else coalesce to true
    ALTER TABLE stage.cleaning_rules
      ADD COLUMN is_active BOOLEAN;
    UPDATE stage.cleaning_rules
      SET is_active = COALESCE(
        (CASE WHEN EXISTS(
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='stage' AND table_name='cleaning_rules' AND column_name='active'
         ) THEN active ELSE NULL END),
        (CASE WHEN EXISTS(
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='stage' AND table_name='cleaning_rules' AND column_name='enabled'
         ) THEN enabled ELSE NULL END),
        TRUE
      );
    ALTER TABLE stage.cleaning_rules ALTER COLUMN is_active SET DEFAULT TRUE;
  END IF;
END$$;

-- stage.document_processing_log alignment
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='document_processing_log' AND column_name='processing_stage'
  ) THEN
    ALTER TABLE stage.document_processing_log ADD COLUMN processing_stage TEXT;
  END IF;

  -- Add processing_metrics; if metrics column exists, mirror it; otherwise add a standalone jsonb
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='document_processing_log' AND column_name='processing_metrics'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='stage' AND table_name='document_processing_log' AND column_name='metrics'
    ) THEN
      ALTER TABLE stage.document_processing_log
        ADD COLUMN processing_metrics JSONB GENERATED ALWAYS AS (metrics) STORED;
    ELSE
      ALTER TABLE stage.document_processing_log
        ADD COLUMN processing_metrics JSONB;
    END IF;
  END IF;
END$$;

-- stage.csv_extractions alignment
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='csv_extractions' AND column_name='review_status'
  ) THEN
    ALTER TABLE stage.csv_extractions ADD COLUMN review_status TEXT;
  END IF;
END$$;

COMMIT;
