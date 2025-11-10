-- Examples: Loading DeepSeek OCR Parquet into md_raw_ocr
-- These snippets assume DeepSeek outputs Parquet files with known schemas.
-- Adjust column mappings to match actual DeepSeek output structure.

-- Prerequisites:
--   ATTACH 'md:md_raw_ocr' AS rawdb (READ_WRITE);
--   SET schema 'rawdb.main';

-- ========================================
-- Example 1: Load raw_documents from Parquet
-- ========================================
-- Expected columns in DeepSeek documents.parquet:
--   doc_id, filename, r2_key, content_type, size_bytes, doc_sha256, uploader,
--   source_meta, hf_space_commit, ocr_model, ocr_image_digest, ocr_params
--
-- Notes:
--   - run_id defaults to 1; increment manually if reprocessing same doc_id
--   - ingest_ts and created_at auto-populate via DEFAULT CURRENT_TIMESTAMP

INSERT INTO raw_documents (
  doc_id, run_id, filename, r2_key, content_type, size_bytes, doc_sha256,
  uploader, source_meta_json, hf_space_commit, ocr_model, ocr_image_digest, ocr_params_json
)
SELECT
  doc_id,
  1 AS run_id,                              -- Increment if reprocessing
  filename,
  r2_key,
  content_type,
  size_bytes,
  doc_sha256,
  uploader,
  source_meta::JSON AS source_meta_json,   -- Cast to JSON if string
  hf_space_commit,
  ocr_model,
  ocr_image_digest,
  ocr_params::JSON AS ocr_params_json
FROM read_parquet('s3://bucket/path/documents_*.parquet');

-- ========================================
-- Example 2: Load raw_pages from Parquet
-- ========================================
-- Expected columns in DeepSeek pages.parquet:
--   doc_id, page_num, page_width, page_height, text, text_sha256, page_image_sha256,
--   ocr_confidence, blocks, lines, tables, figures, ocr_runtime_ms
--
-- Notes:
--   - Match run_id to corresponding raw_documents.run_id
--   - Ensure text_sha256 is precomputed by OCR; recompute if missing:
--       sha256(text::BLOB) AS text_sha256

INSERT INTO raw_pages (
  doc_id, run_id, page_num, page_width, page_height, text, text_sha256,
  page_image_sha256, ocr_confidence, blocks_json, lines_json, tables_json,
  figures_json, ocr_runtime_ms
)
SELECT
  doc_id,
  1 AS run_id,                               -- Match raw_documents.run_id
  page_num,
  page_width,
  page_height,
  text,
  COALESCE(text_sha256, sha256(text::BLOB)) AS text_sha256,  -- Fallback if missing
  page_image_sha256,
  ocr_confidence,
  blocks::JSON AS blocks_json,
  lines::JSON AS lines_json,
  tables::JSON AS tables_json,
  figures::JSON AS figures_json,
  ocr_runtime_ms
FROM read_parquet('s3://bucket/path/pages_*.parquet');

-- ========================================
-- Example 3: Bulk load with error handling
-- ========================================
-- For production, wrap in transaction and validate:
--   1. No duplicate (doc_id, run_id) in raw_documents
--   2. Page counts match expected totals
--   3. Text hashes stable

BEGIN TRANSACTION;

-- Check for duplicates before inserting
CREATE TEMP TABLE load_docs AS
SELECT * FROM read_parquet('s3://bucket/path/documents_*.parquet');

CREATE TEMP TABLE load_pages AS
SELECT * FROM read_parquet('s3://bucket/path/pages_*.parquet');

-- Validate no existing (doc_id, run_id) conflicts
WITH conflicts AS (
  SELECT ld.doc_id
  FROM load_docs ld
  JOIN raw_documents rd ON ld.doc_id = rd.doc_id AND rd.run_id = 1
)
SELECT CASE WHEN COUNT(*) > 0
       THEN ERROR('Duplicate doc_id found for run_id=1')
       ELSE 'OK' END
FROM conflicts;

-- Insert documents
INSERT INTO raw_documents (
  doc_id, run_id, filename, r2_key, content_type, size_bytes, doc_sha256,
  uploader, source_meta_json, hf_space_commit, ocr_model, ocr_image_digest, ocr_params_json
)
SELECT
  doc_id, 1, filename, r2_key, content_type, size_bytes, doc_sha256,
  uploader, source_meta::JSON, hf_space_commit, ocr_model, ocr_image_digest, ocr_params::JSON
FROM load_docs;

-- Insert pages
INSERT INTO raw_pages (
  doc_id, run_id, page_num, page_width, page_height, text, text_sha256,
  page_image_sha256, ocr_confidence, blocks_json, lines_json, tables_json,
  figures_json, ocr_runtime_ms
)
SELECT
  doc_id, 1, page_num, page_width, page_height, text,
  COALESCE(text_sha256, sha256(text::BLOB)),
  page_image_sha256, ocr_confidence,
  blocks::JSON, lines::JSON, tables::JSON, figures::JSON, ocr_runtime_ms
FROM load_pages;

COMMIT;

-- ========================================
-- Example 4: S3/R2 direct load (no local files)
-- ========================================
-- Set up S3 credentials in DuckDB session:
--   INSTALL aws;
--   LOAD aws;
--   SET s3_access_key_id='...';
--   SET s3_secret_access_key='...';
--   SET s3_endpoint='https://<account>.r2.cloudflarestorage.com';
--   SET s3_url_style='path';

INSERT INTO raw_documents (
  doc_id, run_id, filename, r2_key, content_type, size_bytes, doc_sha256,
  uploader, source_meta_json, hf_space_commit, ocr_model, ocr_image_digest, ocr_params_json
)
SELECT
  doc_id, 1, filename, r2_key, content_type, size_bytes, doc_sha256,
  uploader, source_meta::JSON, hf_space_commit, ocr_model, ocr_image_digest, ocr_params::JSON
FROM read_parquet('s3://oceanid-raw/ocr-output/2025-11-09/documents_*.parquet');
