-- V12: Deterministic promotions from stage to curated
-- Implements idempotent promotion function, identifier upsert helper,
-- promotion run audit log, and enrichment view.

BEGIN;

CREATE TABLE IF NOT EXISTS curated.promotion_runs (
  ingestion_id BIGINT PRIMARY KEY,
  promoted_at TIMESTAMPTZ DEFAULT NOW(),
  rows_promoted INTEGER DEFAULT 0,
  last_duration_ms INTEGER,
  run_count INTEGER DEFAULT 0
);

CREATE OR REPLACE FUNCTION curated.upsert_vessel_identifier(
  p_vessel_id BIGINT,
  p_type TEXT,
  p_value TEXT,
  p_dataset_version_id BIGINT,
  p_ingestion_id BIGINT,
  p_confidence NUMERIC,
  p_valid_from TIMESTAMPTZ DEFAULT NULL,
  p_valid_to TIMESTAMPTZ DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_value IS NULL OR p_type IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO curated.vessel_identifiers (
    vessel_id,
    identifier_type,
    identifier_value,
    valid_from,
    valid_to,
    recorded_at,
    confidence,
    dataset_version_id,
    ingestion_id
  ) VALUES (
    p_vessel_id,
    p_type,
    p_value,
    p_valid_from,
    p_valid_to,
    NOW(),
    COALESCE(p_confidence, 1.0),
    p_dataset_version_id,
    p_ingestion_id
  )
  ON CONFLICT (identifier_type, identifier_value)
  DO UPDATE SET
    vessel_id = EXCLUDED.vessel_id,
    valid_from = COALESCE(EXCLUDED.valid_from, curated.vessel_identifiers.valid_from),
    valid_to = COALESCE(EXCLUDED.valid_to, curated.vessel_identifiers.valid_to),
    confidence = GREATEST(EXCLUDED.confidence, COALESCE(curated.vessel_identifiers.confidence, 0)),
    dataset_version_id = COALESCE(EXCLUDED.dataset_version_id, curated.vessel_identifiers.dataset_version_id),
    ingestion_id = COALESCE(EXCLUDED.ingestion_id, curated.vessel_identifiers.ingestion_id),
    recorded_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION curated.promote_ingestion(p_ingestion_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  v_vessel_id BIGINT;
  v_rows INTEGER := 0;
  v_start TIMESTAMPTZ := clock_timestamp();
  v_duration_ms INTEGER;
  v_build_year INTEGER;
BEGIN
  IF p_ingestion_id IS NULL THEN
    RAISE EXCEPTION 'ingestion_id cannot be null';
  END IF;

  FOR rec IN
    WITH ranked AS (
      SELECT
        c.document_id,
        d.dataset_version_id,
        COALESCE(c.ingestion_id, d.ingestion_id) AS ingestion_id,
        lower(c.column_name) AS column_key,
        c.cleaned_value,
        c.confidence,
        ROW_NUMBER() OVER (
          PARTITION BY c.document_id, lower(c.column_name)
          ORDER BY c.confidence DESC NULLS LAST, c.updated_at DESC NULLS LAST, c.id
        ) AS rn,
        d.source_id
      FROM stage.csv_extractions c
      JOIN stage.documents d ON d.id = c.document_id
      WHERE COALESCE(c.ingestion_id, d.ingestion_id) = p_ingestion_id
    ), best AS (
      SELECT * FROM ranked WHERE rn = 1
    )
    SELECT
      b.document_id,
      b.dataset_version_id,
      b.ingestion_id,
      MAX(CASE WHEN column_key = 'imo' THEN cleaned_value END) AS imo,
      MAX(CASE WHEN column_key = 'mmsi' THEN cleaned_value END) AS mmsi,
      MAX(CASE WHEN column_key = 'ircs' THEN cleaned_value END) AS ircs,
      MAX(CASE WHEN column_key IN ('vessel_name','name') THEN cleaned_value END) AS vessel_name,
      MAX(CASE WHEN column_key IN ('flag_code','flag') THEN cleaned_value END) AS flag_code,
      MAX(CASE WHEN column_key = 'vessel_type' THEN cleaned_value END) AS vessel_type,
      MAX(CASE WHEN column_key = 'risk_level' THEN cleaned_value END) AS risk_level,
      MAX(CASE WHEN column_key = 'risk_level' THEN confidence END) AS risk_confidence,
      MAX(CASE WHEN column_key = 'build_year' THEN cleaned_value END) AS build_year_text
    FROM best b
    GROUP BY b.document_id, b.dataset_version_id, b.ingestion_id
  LOOP
    IF rec.dataset_version_id IS NULL THEN
      RAISE EXCEPTION 'dataset_version_id missing for document % (ingestion %)', rec.document_id, rec.ingestion_id;
    END IF;
    IF rec.ingestion_id IS NULL THEN
      RAISE EXCEPTION 'ingestion_id missing for document %', rec.document_id;
    END IF;

    IF rec.imo IS NULL AND rec.mmsi IS NULL AND rec.ircs IS NULL THEN
      CONTINUE;
    END IF;

    SELECT vessel_id INTO v_vessel_id
    FROM curated.vessels
    WHERE (rec.imo IS NOT NULL AND imo = rec.imo)
       OR (rec.mmsi IS NOT NULL AND mmsi = rec.mmsi)
       OR (rec.ircs IS NOT NULL AND ircs = rec.ircs)
    ORDER BY vessel_id
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO curated.vessels (
        imo, mmsi, ircs, vessel_name, flag_code, vessel_type, build_year, risk_level, status
      ) VALUES (
        rec.imo,
        rec.mmsi,
        rec.ircs,
        rec.vessel_name,
        rec.flag_code,
        rec.vessel_type,
        NULL,
        rec.risk_level,
        'active'
      ) RETURNING vessel_id INTO v_vessel_id;
    ELSE
      UPDATE curated.vessels
      SET
        vessel_name = COALESCE(rec.vessel_name, curated.vessels.vessel_name),
        flag_code = COALESCE(rec.flag_code, curated.vessels.flag_code),
        vessel_type = COALESCE(rec.vessel_type, curated.vessels.vessel_type),
        risk_level = COALESCE(rec.risk_level, curated.vessels.risk_level)
      WHERE vessel_id = v_vessel_id;
    END IF;

    v_build_year := NULL;
    IF rec.build_year_text IS NOT NULL THEN
      BEGIN
        v_build_year := NULLIF(trim(rec.build_year_text), '')::INTEGER;
      EXCEPTION WHEN others THEN
        v_build_year := NULL;
      END;
    END IF;

    PERFORM curated.upsert_vessel_identifier(v_vessel_id, 'IMO', rec.imo, rec.dataset_version_id, rec.ingestion_id, 0.99);
    PERFORM curated.upsert_vessel_identifier(v_vessel_id, 'MMSI', rec.mmsi, rec.dataset_version_id, rec.ingestion_id, 0.95);
    PERFORM curated.upsert_vessel_identifier(v_vessel_id, 'IRCS', rec.ircs, rec.dataset_version_id, rec.ingestion_id, 0.9);

    INSERT INTO curated.vessel_info_typed (
      vessel_id,
      dataset_version_id,
      ingestion_id,
      flag_code,
      vessel_type,
      build_year,
      risk_level,
      source_confidence,
      recorded_at
    ) VALUES (
      v_vessel_id,
      rec.dataset_version_id,
      rec.ingestion_id,
      rec.flag_code,
      rec.vessel_type,
      v_build_year,
      rec.risk_level,
      COALESCE(rec.risk_confidence, 1.0),
      NOW()
    )
    ON CONFLICT (vessel_id)
    DO UPDATE SET
      flag_code = COALESCE(EXCLUDED.flag_code, curated.vessel_info_typed.flag_code),
      vessel_type = COALESCE(EXCLUDED.vessel_type, curated.vessel_info_typed.vessel_type),
      build_year = COALESCE(EXCLUDED.build_year, curated.vessel_info_typed.build_year),
      risk_level = CASE
        WHEN EXCLUDED.source_confidence >= COALESCE(curated.vessel_info_typed.source_confidence, 0)
          THEN EXCLUDED.risk_level
        ELSE curated.vessel_info_typed.risk_level
      END,
      source_confidence = GREATEST(EXCLUDED.source_confidence, COALESCE(curated.vessel_info_typed.source_confidence, 0)),
      dataset_version_id = COALESCE(EXCLUDED.dataset_version_id, curated.vessel_info_typed.dataset_version_id),
      ingestion_id = COALESCE(EXCLUDED.ingestion_id, curated.vessel_info_typed.ingestion_id),
      updated_at = NOW();

    v_rows := v_rows + 1;
  END LOOP;

  v_duration_ms := EXTRACT(MILLISECOND FROM (clock_timestamp() - v_start))::INTEGER;

  INSERT INTO curated.promotion_runs (ingestion_id, promoted_at, rows_promoted, last_duration_ms, run_count)
  VALUES (p_ingestion_id, NOW(), v_rows, v_duration_ms, 1)
  ON CONFLICT (ingestion_id)
  DO UPDATE SET
    promoted_at = EXCLUDED.promoted_at,
    rows_promoted = EXCLUDED.rows_promoted,
    last_duration_ms = EXCLUDED.last_duration_ms,
    run_count = curated.promotion_runs.run_count + 1;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE VIEW curated.vessels_enrichment_view AS
SELECT
  v.vessel_id,
  v.imo,
  v.mmsi,
  v.ircs,
  v.vessel_name,
  v.flag_code,
  v.vessel_type,
  info.build_year,
  info.gross_tonnage,
  info.displacement,
  info.length_overall,
  info.beam,
  info.draught,
  info.engine_power_kw,
  info.risk_level,
  info.source_confidence,
  info.dataset_version_id,
  info.ingestion_id,
  info.recorded_at,
  info.updated_at
FROM curated.vessels v
LEFT JOIN curated.vessel_info_typed info USING (vessel_id);

COMMENT ON VIEW curated.vessels_enrichment_view IS 'Stable read surface for tenant enrichment; joins canonical vessel row with typed attributes and provenance metadata.';

COMMIT;
