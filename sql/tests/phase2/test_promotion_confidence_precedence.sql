-- Phase 2: Higher confidence updates overwrite lower confidence values

DO $$
DECLARE
  src_id BIGINT;
  dv_low BIGINT;
  dv_high BIGINT;
  ing_low BIGINT;
  ing_high BIGINT;
  doc_low BIGINT;
  doc_high BIGINT;
  v_target_vessel BIGINT;
BEGIN
  INSERT INTO control.sources (name)
  VALUES ('phase2_source_confidence')
  ON CONFLICT (name) DO UPDATE SET sla_minutes = control.sources.sla_minutes
  RETURNING id INTO src_id;

  INSERT INTO control.dataset_versions (source_id, version, release_date)
  VALUES (src_id, 'conf-low', NOW())
  ON CONFLICT (source_id, version) DO UPDATE SET release_date = EXCLUDED.release_date
  RETURNING id INTO dv_low;

  INSERT INTO control.dataset_versions (source_id, version, release_date)
  VALUES (src_id, 'conf-high', NOW())
  ON CONFLICT (source_id, version) DO UPDATE SET release_date = EXCLUDED.release_date
  RETURNING id INTO dv_high;

  INSERT INTO control.ingestions (dataset_version_id, status, row_count)
  VALUES (dv_low, 'completed', 3)
  RETURNING id INTO ing_low;

  INSERT INTO control.ingestions (dataset_version_id, status, row_count)
  VALUES (dv_high, 'completed', 3)
  RETURNING id INTO ing_high;

  INSERT INTO stage.documents (source_id, source_doc_id, collected_at, text, dataset_version_id, ingestion_id)
  VALUES (src_id, 'conf-doc-low', NOW(), 'low confidence doc', dv_low, ing_low)
  ON CONFLICT (source_id, source_doc_id) DO UPDATE SET text = EXCLUDED.text
  RETURNING id INTO doc_low;

  INSERT INTO stage.documents (source_id, source_doc_id, collected_at, text, dataset_version_id, ingestion_id)
  VALUES (src_id, 'conf-doc-high', NOW(), 'high confidence doc', dv_high, ing_high)
  ON CONFLICT (source_id, source_doc_id) DO UPDATE SET text = EXCLUDED.text
  RETURNING id INTO doc_high;

  INSERT INTO stage.csv_extractions (document_id, row_index, column_name, cleaned_value, confidence, dataset_version_id, ingestion_id)
  VALUES
    (doc_low, 0, 'IMO', 'IMO9990001', 0.70, dv_low, ing_low),
    (doc_low, 0, 'VESSEL_NAME', 'Confidence Vessel', 0.70, dv_low, ing_low),
    (doc_low, 0, 'RISK_LEVEL', 'LOW', 0.55, dv_low, ing_low);

  INSERT INTO stage.csv_extractions (document_id, row_index, column_name, cleaned_value, confidence, dataset_version_id, ingestion_id)
  VALUES
    (doc_high, 0, 'IMO', 'IMO9990001', 0.95, dv_high, ing_high),
    (doc_high, 0, 'VESSEL_NAME', 'Confidence Vessel', 0.92, dv_high, ing_high),
    (doc_high, 0, 'RISK_LEVEL', 'HIGH', 0.90, dv_high, ing_high);

  PERFORM curated.promote_ingestion(ing_low);

  SELECT vessel_id INTO v_target_vessel FROM curated.vessels WHERE imo = 'IMO9990001';
  IF v_target_vessel IS NULL THEN
    RAISE EXCEPTION 'Initial promotion failed to create vessel';
  END IF;

  -- risk level should be LOW after first promotion
  PERFORM 1 FROM curated.vessel_info_typed WHERE vessel_id = v_target_vessel AND risk_level = 'LOW';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected initial risk level LOW';
  END IF;

  -- run high confidence promotion
  PERFORM curated.promote_ingestion(ing_high);

  PERFORM 1 FROM curated.vessel_info_typed WHERE vessel_id = v_target_vessel AND risk_level = 'HIGH' AND source_confidence >= 0.90;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'High confidence update did not override risk level';
  END IF;

  -- Run low confidence ingestion again; should not downgrade risk level
  PERFORM curated.promote_ingestion(ing_low);

  PERFORM 1 FROM curated.vessel_info_typed WHERE vessel_id = v_target_vessel AND risk_level = 'HIGH';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lower confidence run downgraded risk level unexpectedly';
  END IF;
END$$;
