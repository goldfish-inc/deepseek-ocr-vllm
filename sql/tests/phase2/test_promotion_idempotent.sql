-- Phase 2: Promotion function is idempotent and populates curated tables

DO $$
DECLARE
  src_id BIGINT;
  dv_id BIGINT;
  ing_id BIGINT;
  doc_id BIGINT;
  promoted_count INTEGER;
BEGIN
  INSERT INTO control.sources (name)
  VALUES ('phase2_source_idempotent')
  ON CONFLICT (name) DO UPDATE SET sla_minutes = control.sources.sla_minutes
  RETURNING id INTO src_id;

  INSERT INTO control.dataset_versions (source_id, version, release_date)
  VALUES (src_id, 'phase2-v1', NOW())
  ON CONFLICT (source_id, version) DO UPDATE SET release_date = EXCLUDED.release_date
  RETURNING id INTO dv_id;

  INSERT INTO control.ingestions (dataset_version_id, status, row_count)
  VALUES (dv_id, 'completed', 5)
  RETURNING id INTO ing_id;

  INSERT INTO stage.documents (source_id, source_doc_id, collected_at, text, dataset_version_id, ingestion_id)
  VALUES (src_id, 'phase2-doc-1', NOW(), 'promotion test doc', dv_id, ing_id)
  ON CONFLICT (source_id, source_doc_id) DO UPDATE SET text = EXCLUDED.text
  RETURNING id INTO doc_id;

  INSERT INTO stage.csv_extractions (
    document_id,
    row_index,
    column_name,
    cleaned_value,
    confidence,
    dataset_version_id,
    ingestion_id
  ) VALUES
    (doc_id, 0, 'IMO', 'IMO1112223', 0.98, dv_id, ing_id),
    (doc_id, 0, 'MMSI', '123456789', 0.90, dv_id, ing_id),
    (doc_id, 0, 'VESSEL_NAME', 'Ocean Test Vessel', 0.92, dv_id, ing_id),
    (doc_id, 0, 'FLAG_CODE', 'TWN', 0.88, dv_id, ing_id),
    (doc_id, 0, 'VESSEL_TYPE', 'FISHING', 0.86, dv_id, ing_id),
    (doc_id, 0, 'RISK_LEVEL', 'MEDIUM', 0.80, dv_id, ing_id);

  promoted_count := curated.promote_ingestion(ing_id);
  IF promoted_count <> 1 THEN
    RAISE EXCEPTION 'Expected 1 promoted row on first run, got %', promoted_count;
  END IF;

  -- Promotion run recorded
  PERFORM 1 FROM curated.promotion_runs WHERE ingestion_id = ing_id AND rows_promoted = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion_runs missing entry for ingestion %', ing_id;
  END IF;

  -- Curated vessel exists
  PERFORM 1 FROM curated.vessels WHERE imo = 'IMO1112223' AND vessel_name = 'Ocean Test Vessel';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'curated.vessels row missing after promotion';
  END IF;

  -- Identifiers inserted exactly once
  IF (SELECT COUNT(*) FROM curated.vessel_identifiers WHERE identifier_type = 'IMO' AND identifier_value = 'IMO1112223') <> 1 THEN
    RAISE EXCEPTION 'Expected single IMO identifier row';
  END IF;

  -- Typed info populated with confidence
  PERFORM 1 FROM curated.vessel_info_typed
   WHERE vessel_type = 'FISHING'
     AND flag_code = 'TWN'
     AND risk_level = 'MEDIUM'
     AND source_confidence >= 0.80;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'curated.vessel_info_typed missing expected information';
  END IF;

  -- Second run should be idempotent
  promoted_count := curated.promote_ingestion(ing_id);
  IF promoted_count <> 1 THEN
    RAISE EXCEPTION 'Expected repeat run to report 1 row (same doc), got %', promoted_count;
  END IF;

  IF (SELECT run_count FROM curated.promotion_runs WHERE ingestion_id = ing_id) <> 2 THEN
    RAISE EXCEPTION 'promotion_runs run_count not incremented on idempotent run';
  END IF;

  -- No duplicate identifiers created
  IF (SELECT COUNT(*) FROM curated.vessel_identifiers WHERE identifier_type = 'IMO' AND identifier_value = 'IMO1112223') <> 1 THEN
    RAISE EXCEPTION 'Idempotent run created duplicate identifiers';
  END IF;
END$$;
