-- Phase 2: Enrichment view returns promoted vessel data with provenance

DO $$
DECLARE
  src_id BIGINT;
  dv_id BIGINT;
  ing_id BIGINT;
  doc_id BIGINT;
BEGIN
  INSERT INTO control.sources (name)
  VALUES ('phase2_enrichment_view_source')
  ON CONFLICT (name) DO UPDATE SET sla_minutes = control.sources.sla_minutes
  RETURNING id INTO src_id;

  INSERT INTO control.dataset_versions (source_id, version, release_date)
  VALUES (src_id, 'enrichment-v1', NOW())
  ON CONFLICT (source_id, version) DO UPDATE SET release_date = EXCLUDED.release_date
  RETURNING id INTO dv_id;

  INSERT INTO control.ingestions (dataset_version_id, status, row_count)
  VALUES (dv_id, 'completed', 2)
  RETURNING id INTO ing_id;

  INSERT INTO stage.documents (source_id, source_doc_id, collected_at, text, dataset_version_id, ingestion_id)
  VALUES (src_id, 'enrichment-doc', NOW(), 'enrichment doc', dv_id, ing_id)
  ON CONFLICT (source_id, source_doc_id) DO UPDATE SET text = EXCLUDED.text
  RETURNING id INTO doc_id;

  INSERT INTO stage.csv_extractions (document_id, row_index, column_name, cleaned_value, confidence, dataset_version_id, ingestion_id)
  VALUES
    (doc_id, 0, 'IMO', 'IMO5556667', 0.93, dv_id, ing_id),
    (doc_id, 0, 'VESSEL_NAME', 'Enrichment Vessel', 0.90, dv_id, ing_id),
    (doc_id, 0, 'FLAG_CODE', 'PER', 0.85, dv_id, ing_id),
    (doc_id, 0, 'VESSEL_TYPE', 'CARGO', 0.84, dv_id, ing_id);

  PERFORM curated.promote_ingestion(ing_id);

  PERFORM 1
  FROM curated.vessels_enrichment_view
  WHERE imo = 'IMO5556667'
    AND vessel_name = 'Enrichment Vessel'
    AND dataset_version_id = dv_id
    AND ingestion_id = ing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enrichment view did not return promoted vessel';
  END IF;
END$$;
