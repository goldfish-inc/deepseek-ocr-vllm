-- Generate mock Parquet fixtures for Argilla pages/spans
-- Use to validate loader logic end-to-end without real Argilla exports

INSTALL httpfs; LOAD httpfs;

-- PARAMETERS: configure one of the targets (S3/R2 or local filesystem)
CREATE OR REPLACE TEMP TABLE _params AS SELECT
  'local'::VARCHAR AS target,                                 -- 'local' or 's3'
  'mock/parquet/out'::VARCHAR AS local_prefix,
  's3://your-bucket/argilla/mock'::VARCHAR AS s3_prefix,
  'us-east-1'::VARCHAR AS s3_region,
  'minio'::VARCHAR AS s3_endpoint,
  ''::VARCHAR AS s3_access_key_id,
  ''::VARCHAR AS s3_secret_access_key;

-- S3 setup (only used when target='s3')
SET s3_region            = (SELECT s3_region FROM _params);
SET s3_endpoint          = (SELECT s3_endpoint FROM _params) WHERE s3_endpoint <> '';
SET s3_access_key_id     = (SELECT s3_access_key_id FROM _params);
SET s3_secret_access_key = (SELECT s3_secret_access_key FROM _params);
SET s3_url_style         = 'path';

-- MOCK: pages (matches expected export_for_argilla output)
CREATE OR REPLACE TEMP TABLE _pages AS
SELECT
  'MOCK-ULID-001'::VARCHAR AS doc_id,
  1::INTEGER               AS page_num,
  'Sample vessel page text'::TEXT AS text,
  lower(sha256('Sample vessel page text'::BLOB)) AS text_sha256
UNION ALL
SELECT 'MOCK-ULID-001', 2, 'Second page content', lower(sha256('Second page content'::BLOB));

-- MOCK: annotated pages (subset of columns used by loader)
CREATE OR REPLACE TEMP TABLE _ann_pages AS
SELECT
  'rec-1'::VARCHAR AS argilla_record_id,
  'MOCK-ULID-001'::VARCHAR AS doc_id,
  1::INTEGER AS page_num,
  'annotated'::VARCHAR AS status,
  'ann-1'::VARCHAR AS annotator_id,
  NULL::VARCHAR AS reviewer_id,
  lower(sha256('rec1'::BLOB)) AS record_sha256
UNION ALL
SELECT 'rec-2','MOCK-ULID-001',2,'reviewed','ann-2','rev-1',lower(sha256('rec2'::BLOB));

-- MOCK: annotated spans
CREATE OR REPLACE TEMP TABLE _ann_spans AS
SELECT 'rec-1'::VARCHAR AS argilla_record_id,
       'rec-1:1'::VARCHAR AS span_id,
       'MOCK-ULID-001'::VARCHAR AS doc_id,
       1::INTEGER AS page_num,
       'VESSEL_NAME'::VARCHAR AS label,
       0::INTEGER AS start,
       6::INTEGER AS "end",
       'Sample'::TEXT AS text,
       lower(sha256('Sample'::BLOB)) AS text_sha256,
       NULL::VARCHAR AS norm_value,
       'ann-1'::VARCHAR AS annotator_id
UNION ALL
SELECT 'rec-2','rec-2:1','MOCK-ULID-001',2,'MMSI',10,19,'123456789',lower(sha256('123456789'::BLOB)),NULL,'ann-2';

-- OUTPUT PATHS
CREATE OR REPLACE TEMP TABLE _paths AS
SELECT
  CASE WHEN target='s3' THEN s3_prefix || '/pages' ELSE local_prefix || '/pages' END AS pages_path,
  CASE WHEN target='s3' THEN s3_prefix || '/spans' ELSE local_prefix || '/spans' END AS spans_path
FROM _params;

-- WRITE
COPY (SELECT * FROM _pages)
TO (SELECT pages_path || '/data.parquet' FROM _paths)
WITH (FORMAT PARQUET, COMPRESSION 'zstd', OVERWRITE_OR_IGNORE TRUE);

COPY (SELECT * FROM _ann_pages)
TO (SELECT spans_path || '/pages.parquet' FROM _paths)
WITH (FORMAT PARQUET, COMPRESSION 'zstd', OVERWRITE_OR_IGNORE TRUE);

COPY (SELECT * FROM _ann_spans)
TO (SELECT spans_path || '/spans.parquet' FROM _paths)
WITH (FORMAT PARQUET, COMPRESSION 'zstd', OVERWRITE_OR_IGNORE TRUE);

-- REPORT
SELECT 'mock_pages_written' AS info, * FROM _paths;
