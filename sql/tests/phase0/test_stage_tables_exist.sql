-- Phase 0: Minimal staging tables must exist (contract will be tightened in V7)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'stage' AND table_name = 'documents') THEN
    RAISE EXCEPTION 'Missing table: stage.documents';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'stage' AND table_name = 'csv_extractions') THEN
    RAISE EXCEPTION 'Missing table: stage.csv_extractions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'stage' AND table_name = 'cleaning_rules') THEN
    RAISE EXCEPTION 'Missing table: stage.cleaning_rules';
  END IF;
END$$;
