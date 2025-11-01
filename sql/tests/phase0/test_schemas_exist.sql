-- Phase 0: Basic schemas must exist after versioned migrations
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'control') THEN
    RAISE EXCEPTION 'Missing schema: control';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'raw') THEN
    RAISE EXCEPTION 'Missing schema: raw';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'stage') THEN
    RAISE EXCEPTION 'Missing schema: stage';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'curated') THEN
    RAISE EXCEPTION 'Missing schema: curated';
  END IF;
END$$;
