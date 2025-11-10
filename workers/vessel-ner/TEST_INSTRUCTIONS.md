# End-to-End Pipeline Test Instructions

## Overview

The `test-e2e-pipeline.sh` script tests the complete pipeline:
1. **Upload** → PDF via bulk upload function
2. **OCR** → HuggingFace DeepSeek processing
3. **Parquet** → Write to R2 vessel-parquet bucket
4. **MotherDuck** → Load into md_raw_ocr database
5. **Argilla** → Verify data ready for sync

## Prerequisites

### 1. Test PDF
The script will auto-generate a minimal test PDF if not provided:
```bash
# Use auto-generated PDF (recommended for testing)
./test-e2e-pipeline.sh

# Or provide your own PDF
./test-e2e-pipeline.sh path/to/your-vessel-registry.pdf
```

### 2. Optional: API Key (if authentication is enabled)
```bash
export VESSEL_NER_API_KEY="your-api-key-here"
```

### 3. MotherDuck Token (for verification)
```bash
# Get token from Worker secrets (already set)
export MOTHERDUCK_TOKEN=$(pnpm exec wrangler secret list --config wrangler.ocr-processor.toml | grep MOTHERDUCK_TOKEN -A 1 | tail -1 | awk '{print $2}')

# Or use a service token directly
export MOTHERDUCK_TOKEN="your-motherduck-token"
```

## Running the Test

### Full E2E Test
```bash
cd /Users/rt/Developer/oceanid/workers/vessel-ner

# Set MotherDuck token
export MOTHERDUCK_TOKEN="your-token-here"

# Run test
./test-e2e-pipeline.sh
```

### Upload-Only Test (Skip MotherDuck Verification)
```bash
# Just test upload + queue processing
SKIP_MD_CHECK=true ./test-e2e-pipeline.sh
```

### Monitor Processing
```bash
# In another terminal, watch OCR processor logs
pnpm exec wrangler tail vessel-ner-ocr-processor --format pretty
```

## Expected Output

### Success (PASS)
```
╔════════════════════════════════════════╗
║  Vessel NER Pipeline E2E Test          ║
╚════════════════════════════════════════╝

[1/6] Checking prerequisites...
✓ Prerequisites OK

[2/6] Uploading PDF to worker...
✓ Upload successful
   Uploaded as: 2025-11-10T03-42-45-939Z_test-vessel-registry.pdf

[3/6] Waiting for OCR processing...
✓ OCR completed (found 1 document record)
✓ OCR processing complete in 15s

[4/6] Checking Parquet output in R2...
✓ Found Parquet record: run_id=1731203765939
   Source PDF: uploads/2025-11-10T03-42-45-939Z_test-vessel-registry.pdf
   Expected Parquet files:
   - Documents: md_raw_ocr/documents/date=2025-11-10/doc_id=test-vessel-registry/run_id=1731203765939/part-000.parquet
   - Pages: md_raw_ocr/pages/doc_id=test-vessel-registry/run_id=1731203765939/part-000.parquet

[5/6] Verifying MotherDuck data...
✓ Found 1 document record(s) in MotherDuck
   - doc_id: test-vessel-registry, sha256: a1b2c3d4e5f6g7h8..., model: deepseek-ocr-3b
✓ Found 1 page record(s) in MotherDuck
   - Page 1: 87 chars, sha256: 9876543210abcdef...

[6/6] Checking Argilla sync readiness...
✓ Data ready for Argilla sync: 1 pages
   Note: Argilla sync runs every 6 hours via cron
   Check Argilla at: https://argilla.boathou.se

✓ You can now test Argilla
   The OCR data is in MotherDuck and ready to be pulled by Argilla

╔════════════════════════════════════════╗
║           Test Summary                  ║
╚════════════════════════════════════════╝

✓ PASS - End-to-end pipeline working

Pipeline stages verified:
  ✓ Upload API (Cloudflare Workers)
  ✓ OCR Processing (HuggingFace DeepSeek)
  ✓ Parquet Output (R2 vessel-parquet bucket)
  ✓ MotherDuck Storage (md_raw_ocr schema)
  ✓ Argilla Ready (data available for sync)

Total time: 18s

Next steps:
1. Check Argilla at https://argilla.boathou.se
2. Wait for cron sync (every 6 hours) or trigger manually
3. Verify annotations appear in Argilla UI
```

### Partial Success (PARTIAL)
```
⚠ PARTIAL - Pipeline partially working

Status:
  ✓ Upload API working
  ⚠ OCR/MotherDuck data incomplete (may still be processing)

Check logs with:
  pnpm exec wrangler tail vessel-ner-ocr-processor --format pretty
```

## Troubleshooting

### Error: "Upload failed" (401 Unauthorized)
**Cause**: Worker requires API key authentication

**Solution**:
```bash
# Set API key
export VESSEL_NER_API_KEY="your-api-key"

# Run test again
./test-e2e-pipeline.sh
```

### Error: "MOTHERDUCK_TOKEN not set"
**Cause**: Script requires MotherDuck token for verification

**Solution 1** - Skip MotherDuck verification:
```bash
SKIP_MD_CHECK=true ./test-e2e-pipeline.sh
```

**Solution 2** - Provide token:
```bash
export MOTHERDUCK_TOKEN="md_xxx"
./test-e2e-pipeline.sh
```

### Error: "OCR timeout (120s)"
**Cause**: OCR processing took longer than 2 minutes

**Actions**:
1. Check if HuggingFace Space is running:
   ```bash
   curl -H "Authorization: Bearer $HF_TOKEN" \
     https://huggingface.co/api/spaces/goldfish-inc/deepseekocr
   ```

2. Check OCR processor logs:
   ```bash
   pnpm exec wrangler tail vessel-ner-ocr-processor --format pretty
   ```

3. Check queue depth:
   ```bash
   pnpm exec wrangler queues list
   ```

### Error: "No Parquet records found"
**Cause**: OCR processor didn't write Parquet output

**Actions**:
1. Check R2 secrets are set:
   ```bash
   pnpm exec wrangler secret list --config wrangler.ocr-processor.toml | grep R2
   ```
   Should show: `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`

2. Check OCR processor logs for errors:
   ```bash
   pnpm exec wrangler tail vessel-ner-ocr-processor --format pretty
   ```

3. Verify R2 bucket exists:
   ```bash
   pnpm exec wrangler r2 bucket list | grep vessel-parquet
   ```

## Manual Verification

### Check Upload in R2
```bash
# List recent uploads
pnpm exec wrangler r2 object list vessel-pdfs --prefix uploads/ | head -20

# Get specific file
pnpm exec wrangler r2 object get vessel-pdfs/uploads/2025-11-10T03-42-45-939Z_test-vessel-registry.pdf --file /tmp/downloaded.pdf
```

### Check Parquet Output
```bash
# List Parquet files
pnpm exec wrangler r2 object list vessel-parquet --prefix md_raw_ocr/documents/

pnpm exec wrangler r2 object list vessel-parquet --prefix md_raw_ocr/pages/
```

### Query MotherDuck Directly
```bash
# Requires MotherDuck CLI: https://motherduck.com/docs/getting-started/connect-query-from-cli/
duckdb md:vessel_intelligence -c "SELECT * FROM md_raw_ocr.raw_documents LIMIT 5"

duckdb md:vessel_intelligence -c "SELECT * FROM md_raw_ocr.raw_pages LIMIT 10"
```

### Check Argilla
```bash
# Via Argilla API (requires API key)
curl -X GET "https://argilla.boathou.se/api/v1/datasets/vessel-records/records" \
  -H "Authorization: Bearer $ARGILLA_API_KEY"

# Via Web UI
open https://argilla.boathou.se
```

## What Happens Next?

After the test passes:

1. **Argilla Sync** (automatic, every 6 hours):
   - Cron trigger runs `argilla-sync` worker
   - Pulls OCR data from MotherDuck
   - Creates annotation records in Argilla
   - Updates `synced_to_argilla` flag

2. **SME Annotation**:
   - SMEs access Argilla at https://argilla.boathou.se
   - Review OCR text
   - Annotate entities (VESSEL_NAME, IMO_NUMBER, FLAG_STATE, etc.)
   - Submit annotations

3. **Annotation Export**:
   - Annotated data exported to MotherDuck `md_annotated` schema
   - Available for downstream ML training and analysis

## Performance Expectations

| Stage | Expected Time | Notes |
|-------|---------------|-------|
| Upload | < 1s | Network dependent |
| Queue | < 5s | Message delivery |
| OCR (1 page) | 5-15s | HuggingFace T4 GPU |
| OCR (10 pages) | 30-90s | Sequential processing |
| Parquet Write | < 1s | WASM compilation |
| MotherDuck Insert | < 1s | Batch insert |
| **Total (1 page)** | **10-25s** | End-to-end |

## Test File Details

The auto-generated test PDF contains:
- 1 page
- Simple text content
- Test vessel information:
  - Vessel Name: MV Test Ship
  - IMO: 1234567
  - Flag: Panama

This minimal PDF is sufficient to test the complete pipeline without large file overhead.

## Cleanup

The test creates a `test-vessel-registry.pdf` file in the current directory. You can delete it after testing:

```bash
rm test-vessel-registry.pdf
```

R2 lifecycle policies will automatically delete uploaded files after 90 days.

---

**Version**: 1.0.0
**Last Updated**: 2025-11-10
**Related Docs**:
- `ARCHITECTURE.md` - System architecture
- `HUGGINGFACE_OCR_INTEGRATION.md` - OCR integration details
- `BULK_UPLOAD_SECURITY.md` - Security hardening
- `SETUP.md` - Initial setup instructions
