-- Phase 0: Worker contract columns must exist after V7
DO $$
DECLARE
  missing text := '';
BEGIN
  -- cleaning_rules: column_name, is_active
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='cleaning_rules' AND column_name='column_name'
  ) THEN
    missing := missing || E'\nstage.cleaning_rules.column_name';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='cleaning_rules' AND column_name='is_active'
  ) THEN
    missing := missing || E'\nstage.cleaning_rules.is_active';
  END IF;

  -- document_processing_log: processing_stage, processing_metrics
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='document_processing_log' AND column_name='processing_stage'
  ) THEN
    missing := missing || E'\nstage.document_processing_log.processing_stage';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='document_processing_log' AND column_name='processing_metrics'
  ) THEN
    missing := missing || E'\nstage.document_processing_log.processing_metrics';
  END IF;

  -- csv_extractions: review_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='stage' AND table_name='csv_extractions' AND column_name='review_status'
  ) THEN
    missing := missing || E'\nstage.csv_extractions.review_status';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'Missing required worker contract columns:%', missing;
  END IF;
END$$;
