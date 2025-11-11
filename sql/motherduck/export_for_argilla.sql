-- Export latest OCR pages to Parquet for Argilla ingestion
-- Context: run in a DuckDB session with MotherDuck + httpfs S3 settings

-- Attach raw DB
ATTACH 'md:md_raw_ocr' AS rawdb (READ_ONLY);

-- Ensure httpfs is available for S3/R2
INSTALL httpfs; LOAD httpfs;

-- PARAMETERS: set your bucket/prefix and optional batch filter
-- Use a temp params table to avoid editing multiple lines
CREATE OR REPLACE TEMP TABLE _params AS SELECT
  's3://your-bucket/argilla/in/vessels_ocr_BATCHID'::VARCHAR AS out_prefix,
  'us-east-1'::VARCHAR AS s3_region,
  'minio'::VARCHAR AS s3_endpoint,              -- set to empty if using AWS S3
  ''::VARCHAR AS s3_access_key_id,
  ''::VARCHAR AS s3_secret_access_key;

-- S3/R2 credentials (if required)
SET s3_region              = (SELECT s3_region FROM _params);
SET s3_endpoint            = (SELECT s3_endpoint FROM _params) WHERE s3_endpoint <> '';
SET s3_access_key_id       = (SELECT s3_access_key_id FROM _params);
SET s3_secret_access_key   = (SELECT s3_secret_access_key FROM _params);
SET s3_url_style           = 'path';

-- OPTIONAL: Limit to a list of doc_ids
-- CREATE OR REPLACE TEMP TABLE _doc_ids(doc_id VARCHAR);
-- INSERT INTO _doc_ids VALUES ('ULID1'), ('ULID2');

-- Export query: latest pages with stable identifiers
CREATE OR REPLACE TEMP VIEW _argilla_source AS
SELECT doc_id, page_num, text, text_sha256
FROM rawdb.main.vw_argilla_pages
-- WHERE doc_id IN (SELECT doc_id FROM _doc_ids)
;

-- Export as Parquet, partitioned by doc_id for parallel Argilla ingest
COPY (
  SELECT * FROM _argilla_source
) TO (
  SELECT out_prefix || '/' AS path FROM _params
) WITH (
  FORMAT PARQUET,
  PARTITION_BY (doc_id),
  COMPRESSION 'zstd',
  OVERWRITE_OR_IGNORE TRUE
);
