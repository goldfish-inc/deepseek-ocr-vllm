-- Phase 1: Curated core entities integrity

DO $$
DECLARE
  src_id BIGINT;
  dv_id BIGINT;
  ing_id BIGINT;
  v_id BIGINT;
BEGIN
  -- Ensure prerequisite tables exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='curated' AND table_name='vessel_identifiers'
  ) THEN
    RAISE EXCEPTION 'Missing table curated.vessel_identifiers';
  END IF;

  -- Provision dataset provenance entries
  SELECT id INTO src_id
  FROM control.sources WHERE name = 'phase1_curated_core_source';

  IF src_id IS NULL THEN
    INSERT INTO control.sources (name)
    VALUES ('phase1_curated_core_source')
    RETURNING id INTO src_id;
  END IF;

  BEGIN
    INSERT INTO control.dataset_versions (source_id, version, release_date)
    VALUES (src_id, '2025-Q1', NOW())
    RETURNING id INTO dv_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO dv_id FROM control.dataset_versions WHERE source_id = src_id AND version = '2025-Q1';
  END;

  INSERT INTO control.ingestions (dataset_version_id, status, row_count)
  VALUES (dv_id, 'completed', 42)
  RETURNING id INTO ing_id;

  -- Insert canonical vessel
  INSERT INTO curated.vessels (imo, vessel_name, flag_code, vessel_type)
  VALUES ('IMO1234567', 'Phase1 Vessel', 'TWN', 'FISHING')
  RETURNING vessel_id INTO v_id;

  -- Ensure duplicate IMO is rejected
  BEGIN
    INSERT INTO curated.vessels (imo, vessel_name)
    VALUES ('IMO1234567', 'Duplicate Vessel');
    RAISE EXCEPTION 'Duplicate IMO allowed unexpectedly';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  INSERT INTO curated.vessel_identifiers (
      vessel_id, identifier_type, identifier_value, valid_from,
      recorded_at, confidence, dataset_version_id, ingestion_id)
  VALUES (
      v_id, 'MMSI', '123456789', NOW() - INTERVAL '1 day',
      NOW(), 0.95, dv_id, ing_id
  );

  INSERT INTO curated.vessel_info_typed (
      vessel_id, dataset_version_id, ingestion_id,
      vessel_type, flag_code, build_year, gross_tonnage,
      length_overall, beam, risk_level, source_confidence)
  VALUES (
      v_id, dv_id, ing_id,
      'FISHING', 'TWN', 2001, 3200.50,
      72.4, 12.3, 'MEDIUM', 0.92
  );

  INSERT INTO curated.vessel_associates (
      vessel_id, associate_type, entity_name, role,
      valid_from, confidence, dataset_version_id, ingestion_id)
  VALUES (
      v_id, 'OPERATOR', 'Taiwan Fishing Co', 'Operator',
      NOW(), 0.9, dv_id, ing_id
  );

  -- Delete dataset version -> columns should null out (SET NULL) but rows remain
  DELETE FROM control.dataset_versions WHERE id = dv_id;

  PERFORM 1 FROM curated.vessel_identifiers
    WHERE vessel_id = v_id AND dataset_version_id IS NOT NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'dataset_version_id was not cleared in curated.vessel_identifiers';
  END IF;

  PERFORM 1 FROM curated.vessel_info_typed
    WHERE vessel_id = v_id AND dataset_version_id IS NOT NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'dataset_version_id was not cleared in curated.vessel_info_typed';
  END IF;

  PERFORM 1 FROM curated.vessel_associates
    WHERE vessel_id = v_id AND dataset_version_id IS NOT NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'dataset_version_id was not cleared in curated.vessel_associates';
  END IF;

  -- Clean up to keep test idempotent
  DELETE FROM curated.vessel_associates WHERE vessel_id = v_id;
  DELETE FROM curated.vessel_info_typed WHERE vessel_id = v_id;
  DELETE FROM curated.vessel_identifiers WHERE vessel_id = v_id;
  DELETE FROM curated.vessels WHERE vessel_id = v_id;
END$$;
