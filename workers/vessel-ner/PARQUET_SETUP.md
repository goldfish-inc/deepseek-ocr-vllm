# Parquet-Native OCR Pipeline Setup

## Overview

The OCR processor now writes Parquet files directly to R2, which are then loaded into MotherDuck using SQL loaders. This eliminates SQL INSERTs from the worker and maintains full provenance tracking.

## Architecture

```
PDF Upload → DeepSeek OCR → Parquet Files (R2) → MotherDuck (md_raw_ocr) → Argilla → Annotations (md_annotated)
```

**Parquet Output:**
- `md_raw_ocr/documents/date=YYYY-MM-DD/doc_id={doc_id}/run_id={run_id}/part-000.parquet`
- `md_raw_ocr/pages/doc_id={doc_id}/run_id={run_id}/part-000.parquet`

## Prerequisites

### 1. Create R2 Bucket for Parquet Files

```bash
cd workers/vessel-ner
pnpm exec wrangler r2 bucket create vessel-parquet
```

✅ **Status**: Created `vessel-parquet` bucket

### 2. Generate R2 API Credentials

```bash
# Create R2 API token with read/write access to vessel-parquet bucket
pnpm exec wrangler r2 bucket credentials create vessel-parquet-writer \
  --bucket vessel-parquet \
  --permissions read,write
```

**Output:**
```
Access Key ID: <R2_ACCESS_KEY_ID>
Secret Access Key: <R2_SECRET_ACCESS_KEY>
```

### 3. Set Cloudflare Worker Secrets

```bash
# Set R2 API credentials
pnpm exec wrangler secret put R2_ACCESS_KEY_ID --config wrangler.ocr-processor.toml
# Paste: <R2_ACCESS_KEY_ID>

pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY --config wrangler.ocr-processor.toml
# Paste: <R2_SECRET_ACCESS_KEY>

# Set HuggingFace token (if not already set)
pnpm exec wrangler secret put HF_TOKEN --config wrangler.ocr-processor.toml
# Paste: hf_...
```

### 4. Create MotherDuck Databases

**Run once to create schema:**

```bash
# Install DuckDB CLI
brew install duckdb

# Get MotherDuck token
export MOTHERDUCK_TOKEN=$(op read "op://Development/MotherDuck/credential")

# Connect to MotherDuck
duckdb -unsigned

# In DuckDB shell:
SET motherduck_token='<paste MOTHERDUCK_TOKEN>';

-- Create raw OCR database
ATTACH 'md:md_raw_ocr' AS rawdb (READ_WRITE);
SET schema 'rawdb.main';
.read ../../sql/motherduck/raw_ocr.sql
.read ../../sql/motherduck/views_raw.sql

-- Create annotated database
ATTACH 'md:md_annotated' AS anndb (READ_WRITE);
SET schema 'anndb.main';
.read ../../sql/motherduck/annotated.sql
.read ../../sql/motherduck/views_annotated.sql
.read ../../sql/motherduck/argilla_ingest_log.sql

-- Verify
SHOW TABLES;
```

## Deploy Worker

```bash
cd workers/vessel-ner

# Deploy OCR processor with Parquet output
pnpm exec wrangler deploy --config wrangler.ocr-processor.toml

# Verify deployment
pnpm exec wrangler tail vessel-ner-ocr-processor --format pretty
```

## Testing End-to-End

### 1. Upload PDF

```bash
# Upload test PDF
curl -X POST https://vessel-ner.ryan-8fa.workers.dev/upload \
  -F "file=@/path/to/test.pdf"

# Expected: {"success":true,"message":"PDF uploaded and queued for processing"}
```

### 2. Monitor Parquet Generation

```bash
# Watch OCR processor logs
pnpm exec wrangler tail vessel-ner-ocr-processor --format pretty

# Look for events:
# - parquet_documents_written
# - parquet_pages_written
# - ocr_completed (with parquet keys)
```

### 3. Verify Parquet Files in R2

```bash
# List Parquet files
pnpm exec wrangler r2 object list vessel-parquet --prefix md_raw_ocr/

# Expected output:
# md_raw_ocr/documents/date=2025-11-09/doc_id=test/run_id=1762749500000/part-000.parquet
# md_raw_ocr/pages/doc_id=test/run_id=1762749500000/part-000.parquet
```

### 4. Load Parquet into MotherDuck

```bash
# In DuckDB shell connected to MotherDuck
ATTACH 'md:md_raw_ocr' AS rawdb (READ_WRITE);
SET schema 'rawdb.main';

# Configure S3/R2 access
INSTALL aws;
LOAD aws;
SET s3_endpoint='https://8fa97474778c8a894925c148ca829739.r2.cloudflarestorage.com';
SET s3_access_key_id='<R2_ACCESS_KEY_ID>';
SET s3_secret_access_key='<R2_SECRET_ACCESS_KEY>';
SET s3_url_style='path';

# Load documents
INSERT INTO raw_documents
SELECT * FROM read_parquet('s3://vessel-parquet/md_raw_ocr/documents/**/*.parquet');

# Load pages
INSERT INTO raw_pages
SELECT * FROM read_parquet('s3://vessel-parquet/md_raw_ocr/pages/**/*.parquet');

# Verify
SELECT doc_id, run_id, filename, COUNT(*) as page_count
FROM raw_documents d
JOIN raw_pages p USING (doc_id, run_id)
GROUP BY doc_id, run_id, filename;

-- Check vw_argilla_pages view
SELECT COUNT(*) FROM rawdb.main.vw_argilla_pages;
```

## Parquet Schema

### raw_documents

| Column | Type | Description |
|--------|------|-------------|
| doc_id | VARCHAR | Document identifier (filename without .pdf) |
| run_id | BIGINT | OCR run timestamp (Date.now()) |
| ingest_ts | TIMESTAMP | When document was ingested |
| filename | VARCHAR | Original PDF filename |
| r2_key | VARCHAR | R2 object key |
| content_type | VARCHAR | MIME type (application/pdf) |
| size_bytes | BIGINT | PDF file size |
| doc_sha256 | VARCHAR | SHA256 hash of PDF bytes |
| uploader | VARCHAR | User/service that uploaded |
| source_meta_json | VARCHAR | JSON metadata (uploaded_at, etc.) |
| hf_space_commit | VARCHAR | HF Space git commit SHA |
| ocr_model | VARCHAR | DeepSeek model version |
| ocr_image_digest | VARCHAR | Container image digest |
| ocr_params_json | VARCHAR | JSON OCR parameters (base_size, etc.) |

### raw_pages

| Column | Type | Description |
|--------|------|-------------|
| doc_id | VARCHAR | Document identifier |
| run_id | BIGINT | OCR run timestamp |
| page_num | INTEGER | Page number (1-indexed) |
| page_width | DOUBLE | Page width (null if unavailable) |
| page_height | DOUBLE | Page height (null if unavailable) |
| text | VARCHAR | OCR extracted text |
| text_sha256 | VARCHAR | SHA256 hash of text |
| page_image_sha256 | VARCHAR | Hash of page image (optional) |
| ocr_confidence | DOUBLE | OCR confidence score (optional) |
| blocks_json | VARCHAR | JSON blocks structure (optional) |
| lines_json | VARCHAR | JSON lines structure (optional) |
| tables_json | VARCHAR | JSON tables structure (optional) |
| figures_json | VARCHAR | JSON figures structure (optional) |
| ocr_runtime_ms | BIGINT | OCR processing time per page (optional) |
| created_at | TIMESTAMP | When page was processed |

## Provenance Tracking

**Full chain of custody:**
1. `doc_sha256`: Hash of original PDF (tamper detection)
2. `text_sha256`: Hash of OCR text (integrity verification)
3. `hf_space_commit`: DeepSeek OCR Space git commit
4. `ocr_model` + `ocr_image_digest`: Model version and container
5. `ocr_params_json`: OCR configuration (base_size, etc.)
6. `run_id`: Monotonic timestamp for re-runs

## Troubleshooting

### Issue: "Missing R2 credentials"

**Symptom:**
```
Error: Cannot read properties of undefined (reading 's3Endpoint')
```

**Solution:**
```bash
# Verify secrets are set
pnpm exec wrangler secret list --config wrangler.ocr-processor.toml

# Should show:
# R2_ACCESS_KEY_ID
# R2_SECRET_ACCESS_KEY
# HF_TOKEN
```

### Issue: "Bucket not found"

**Symptom:**
```
Error: NoSuchBucket: The specified bucket does not exist
```

**Solution:**
```bash
# Verify bucket exists
pnpm exec wrangler r2 bucket list

# Should show: vessel-parquet
```

### Issue: "Parquet write failed"

**Symptom:**
```
Error: Failed to write Parquet file
```

**Solution:**
1. Check R2 credentials are correct
2. Verify bucket permissions (read/write)
3. Check worker logs for detailed error:
   ```bash
   pnpm exec wrangler tail vessel-ner-ocr-processor
   ```

### Issue: "MotherDuck load failed"

**Symptom:**
```
Error: Invalid Input Error: Could not read Parquet file
```

**Solution:**
1. Verify Parquet files exist in R2
2. Check S3 credentials in DuckDB session
3. Test read directly:
   ```sql
   SELECT * FROM read_parquet('s3://vessel-parquet/md_raw_ocr/documents/**/*.parquet') LIMIT 1;
   ```

## Next Steps

1. **Pre-annotation**: Add Spark + Ollama worker to generate suggestions Parquet
2. **Argilla integration**: Export pages Parquet → merge with suggestions → load to Argilla
3. **Annotations pull**: Argilla export → annotated Parquet → load to md_annotated
4. **Monitoring**: Set up integrity checks from `sql/motherduck/checks_integrity.sql`

## References

- [MotherDuck SQL Loaders](../../sql/motherduck/README.md)
- [Parquet Flow Documentation](../../docs/operations/argilla-parquet-flow.md)
- [Pre-annotation Spec](../../docs/operations/preannotation-spark-ollama-spec.md)
- [Argilla Auto-Discovery](../../docs/operations/argilla-auto-discovery.md)
