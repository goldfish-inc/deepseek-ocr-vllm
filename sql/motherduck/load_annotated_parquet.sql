-- Load Argilla-exported Parquet into md_annotated tables via staged temp tables
-- Context: DuckDB with MotherDuck + httpfs. Execute in a session with anndb attached.

-- Attach annotated DB
ATTACH 'md:md_annotated' AS anndb (READ_WRITE);
SET schema 'anndb.main';

INSTALL httpfs; LOAD httpfs;

-- PARAMETERS
CREATE OR REPLACE TEMP TABLE _params AS SELECT
  'vessels_ocr_BATCHID'::VARCHAR AS argilla_dataset,
  'sha256:CHANGE_ME'::VARCHAR    AS export_checksum,
  'argilla-loader/1.0.0'::VARCHAR AS tool_version,
  's3://your-bucket/argilla/out/vessels_ocr_BATCHID/pages/*.parquet'::VARCHAR AS pages_glob,
  's3://your-bucket/argilla/out/vessels_ocr_BATCHID/spans/*.parquet'::VARCHAR  AS spans_glob,
  'us-east-1'::VARCHAR  AS s3_region,
  'minio'::VARCHAR      AS s3_endpoint,
  ''::VARCHAR           AS s3_access_key_id,
  ''::VARCHAR           AS s3_secret_access_key;

SET s3_region            = (SELECT s3_region FROM _params);
SET s3_endpoint          = (SELECT s3_endpoint FROM _params) WHERE s3_endpoint <> '';
SET s3_access_key_id     = (SELECT s3_access_key_id FROM _params);
SET s3_secret_access_key = (SELECT s3_secret_access_key FROM _params);
SET s3_url_style         = 'path';

-- STAGE: incoming pages
CREATE OR REPLACE TEMP TABLE _incoming_pages AS
SELECT
  CAST(argilla_record_id AS VARCHAR) AS argilla_record_id,
  CAST(doc_id AS VARCHAR)            AS doc_id,
  CAST(page_num AS INTEGER)          AS page_num,
  CAST(status AS VARCHAR)            AS status,
  CAST(annotator_id AS VARCHAR)      AS annotator_id,
  CAST(reviewer_id AS VARCHAR)       AS reviewer_id,
  CAST(record_sha256 AS VARCHAR)     AS record_sha256
FROM read_parquet((SELECT pages_glob FROM _params));

-- STAGE: incoming spans
CREATE OR REPLACE TEMP TABLE _incoming_spans AS
SELECT
  CAST(argilla_record_id AS VARCHAR) AS argilla_record_id,
  CAST(span_id AS VARCHAR)           AS span_id,
  CAST(doc_id AS VARCHAR)            AS doc_id,
  CAST(page_num AS INTEGER)          AS page_num,
  CAST(label AS VARCHAR)             AS label,
  CAST(start AS INTEGER)             AS start,
  CAST("end" AS INTEGER)            AS "end",
  CAST(text AS VARCHAR)              AS text,
  CAST(text_sha256 AS VARCHAR)       AS text_sha256,
  CAST(norm_value AS VARCHAR)        AS norm_value,
  CAST(annotator_id AS VARCHAR)      AS annotator_id
FROM read_parquet((SELECT spans_glob FROM _params));

-- LOAD
.read sql/motherduck/argilla_export_loader_from_staged.sql

-- VERIFY
SELECT 'pages_loaded' AS check_name, COUNT(*) AS n
FROM annotations_pages WHERE argilla_dataset = (SELECT argilla_dataset FROM _params);

SELECT 'spans_loaded' AS check_name, COUNT(*) AS n
FROM annotations_spans WHERE argilla_dataset = (SELECT argilla_dataset FROM _params);
