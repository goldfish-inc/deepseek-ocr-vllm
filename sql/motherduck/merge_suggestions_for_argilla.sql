-- Merge pages + suggestions Parquet into Argilla-ready records Parquet
-- Produces a single file with page text and a suggestions column for Argilla ingestion.
-- This is Argilla-agnostic and keeps control of join/shape in our pipeline.

-- Prereqs: DuckDB with httpfs (and optionally json) extensions
INSTALL httpfs; LOAD httpfs;
INSTALL json;   LOAD json;

-- PARAMETERS
CREATE OR REPLACE TEMP TABLE _params AS SELECT
  's3://your-bucket/argilla/in/vessels_ocr_BATCHID/pages/*.parquet'::VARCHAR       AS pages_glob,
  's3://your-bucket/argilla/in/vessels_ocr_BATCHID/suggestions/*.parquet'::VARCHAR AS suggestions_glob,
  's3://your-bucket/argilla/in/vessels_ocr_BATCHID/argilla_records.parquet'::VARCHAR AS output_uri,
  'us-east-1'::VARCHAR AS s3_region,
  'minio'::VARCHAR     AS s3_endpoint,
  ''::VARCHAR          AS s3_access_key_id,
  ''::VARCHAR          AS s3_secret_access_key;

-- S3/R2 setup (no-op if using AWS defaults and endpoint is empty)
SET s3_region            = (SELECT s3_region FROM _params);
SET s3_endpoint          = (SELECT s3_endpoint FROM _params) WHERE s3_endpoint <> '';
SET s3_access_key_id     = (SELECT s3_access_key_id FROM _params);
SET s3_secret_access_key = (SELECT s3_secret_access_key FROM _params);
SET s3_url_style         = 'path';

-- Load pages (from export_for_argilla.sql output)
CREATE OR REPLACE TEMP TABLE pages AS
SELECT doc_id, page_num, text, text_sha256
FROM read_parquet((SELECT pages_glob FROM _params));

-- Load suggestions (from pre-annotation job per PREANNOTATION_SCHEMA.md)
CREATE OR REPLACE TEMP TABLE suggestions AS
SELECT
  CAST(doc_id AS VARCHAR)         AS doc_id,
  CAST(page_num AS INTEGER)       AS page_num,
  CAST(label AS VARCHAR)          AS label,
  CAST(start AS INTEGER)          AS start,
  CAST("end" AS INTEGER)         AS "end",
  CAST(confidence AS DOUBLE)      AS confidence,
  CAST(model AS VARCHAR)          AS model,
  CAST(model_version AS VARCHAR)  AS model_version
FROM read_parquet((SELECT suggestions_glob FROM _params));

-- Aggregate suggestions into list-of-struct per page
CREATE OR REPLACE TEMP TABLE page_suggestions AS
SELECT
  doc_id,
  page_num,
  LIST(STRUCT_PACK(start := start, end := "end", label := label ORDER BY start)) AS entities,
  AVG(confidence) AS avg_confidence,
  ANY_VALUE(model) AS model,              -- Prefer the same model per batch; ANY_VALUE to avoid GROUP BY duplication
  ANY_VALUE(model_version) AS model_version
FROM suggestions
GROUP BY doc_id, page_num;

-- Build Argilla-ready records
-- We provide both typed columns and a JSON suggestions array for convenience.
CREATE OR REPLACE TEMP VIEW argilla_records AS
SELECT
  -- Stable record id for Argilla
  CONCAT(p.doc_id, ':', p.page_num) AS id,
  p.text,
  p.doc_id,
  p.page_num,
  p.text_sha256,

  -- Typed form: list of structs for the entities (label, start, end)
  COALESCE(s.entities, LIST()) AS suggestions_entities,
  s.avg_confidence             AS suggestions_score,
  s.model                      AS suggestions_agent,
  'model'                      AS suggestions_type,

  -- JSON form matching Argilla record suggestion shape (array with one entry)
  CASE WHEN s.entities IS NULL OR LIST_LENGTH(s.entities) = 0 THEN to_json(LIST_VALUE())
       ELSE to_json(LIST_VALUE(
              STRUCT_PACK(
                question_name := 'entities',
                value := s.entities,
                score := s.avg_confidence,
                agent := COALESCE(s.model || COALESCE(':' || s.model_version, ''), 'unknown'),
                type := 'model'
              )
            ))
  END AS suggestions_json
FROM pages p
LEFT JOIN page_suggestions s
  ON p.doc_id = s.doc_id AND p.page_num = s.page_num;

-- Write a single Parquet file for Argilla ingestion
COPY (
  SELECT * FROM argilla_records
) TO (SELECT output_uri FROM _params)
WITH (FORMAT PARQUET, COMPRESSION 'zstd', OVERWRITE_OR_IGNORE TRUE);

-- Report
SELECT 'merge_output' AS info, (SELECT output_uri FROM _params) AS uri,
       (SELECT COUNT(*) FROM argilla_records) AS record_count;
