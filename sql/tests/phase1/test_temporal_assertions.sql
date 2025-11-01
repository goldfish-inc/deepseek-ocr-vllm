-- Phase 1: Temporal assertions + watchlist events

DO $$
DECLARE
  src_id BIGINT;
  dv_id BIGINT;
  ing_id BIGINT;
  doc_id BIGINT;
  v_id BIGINT;
BEGIN
  -- Setup provenance
  SELECT id INTO src_id FROM control.sources WHERE name = 'phase1_temporal_source';
  IF src_id IS NULL THEN
    INSERT INTO control.sources (name)
    VALUES ('phase1_temporal_source')
    RETURNING id INTO src_id;
  END IF;

  BEGIN
    INSERT INTO control.dataset_versions (source_id, version)
    VALUES (src_id, '2025-temporal')
    RETURNING id INTO dv_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO dv_id FROM control.dataset_versions
      WHERE source_id = src_id AND version = '2025-temporal';
  END;

  INSERT INTO control.ingestions (dataset_version_id, status)
  VALUES (dv_id, 'completed')
  RETURNING id INTO ing_id;

  -- Stage document for provenance
  INSERT INTO stage.documents (source_id, source_doc_id, collected_at, text)
  VALUES (src_id, 'phase1-doc', NOW(), 'phase1 provenance document')
  ON CONFLICT (source_id, source_doc_id) DO UPDATE SET text = EXCLUDED.text
  RETURNING id INTO doc_id;

  -- Canonical vessel
  INSERT INTO curated.vessels (imo, vessel_name, flag_code, vessel_type)
  VALUES ('IMO7654321', 'Temporal Vessel', 'PER', 'CARGO')
  RETURNING vessel_id INTO v_id;

  INSERT INTO curated.vessel_attribute_assertions (
      vessel_id, attribute, value_json, value_text,
      valid_from, valid_to, confidence, dataset_version_id,
      ingestion_id, document_id)
  VALUES (
      v_id, 'GEAR_TYPE', '{"code":"OTB"}', 'OTB',
      NOW() - INTERVAL '2 years', NOW() - INTERVAL '1 year', 0.85,
      dv_id, ing_id, doc_id
  );

  INSERT INTO curated.vessel_watchlist_events (
      vessel_id, list_name, jurisdiction, status,
      reason, valid_from, dataset_version_id, ingestion_id, document_id)
  VALUES (
      v_id, 'IUU Watchlist', 'Peru', 'active',
      'Suspected transshipment', NOW() - INTERVAL '6 months',
      dv_id, ing_id, doc_id
  );

  -- Attempt invalid period should fail
  BEGIN
    INSERT INTO curated.vessel_attribute_assertions (
        vessel_id, attribute, value_json, valid_from, valid_to)
    VALUES (v_id, 'FLAG_HISTORY', '{"country":"PER"}', NOW(), NOW() - INTERVAL '1 day');
    RAISE EXCEPTION 'Invalid valid_from/valid_to accepted unexpectedly';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Delete ingestion (cascades from dataset version) and ensure referencing columns NULL
  DELETE FROM control.dataset_versions WHERE id = dv_id;

  PERFORM 1 FROM curated.vessel_attribute_assertions
    WHERE vessel_id = v_id AND (dataset_version_id IS NOT NULL OR ingestion_id IS NOT NULL);
  IF FOUND THEN
    RAISE EXCEPTION 'Provenance columns not nulled in vessel_attribute_assertions after version delete';
  END IF;

  PERFORM 1 FROM curated.vessel_watchlist_events
    WHERE vessel_id = v_id AND (dataset_version_id IS NOT NULL OR ingestion_id IS NOT NULL);
  IF FOUND THEN
    RAISE EXCEPTION 'Provenance columns not nulled in vessel_watchlist_events after version delete';
  END IF;

  DELETE FROM curated.vessel_watchlist_events WHERE vessel_id = v_id;
  DELETE FROM curated.vessel_attribute_assertions WHERE vessel_id = v_id;
  DELETE FROM curated.vessels WHERE vessel_id = v_id;
  DELETE FROM stage.documents WHERE id = doc_id;
END$$;
