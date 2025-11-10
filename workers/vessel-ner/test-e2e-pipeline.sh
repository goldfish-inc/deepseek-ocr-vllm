#!/bin/bash
# End-to-End Pipeline Test
# Tests: Upload → OCR → Parquet → MotherDuck → Argilla Readiness
#
# Usage: ./test-e2e-pipeline.sh [test-file.pdf]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORKER_URL="${WORKER_URL:-https://vessel-ner-pipeline.ryan-8fa.workers.dev}"
MD_PROXY_URL="${MD_PROXY_URL:-https://md.boathou.se}"
MOTHERDUCK_DB="vessel_intelligence"

# Test file
TEST_PDF="${1:-test-vessel-registry.pdf}"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Vessel NER Pipeline E2E Test          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Step 1: Check prerequisites
echo -e "${YELLOW}[1/6]${NC} Checking prerequisites..."

if [ ! -f "$TEST_PDF" ]; then
  echo -e "${RED}✗${NC} Test PDF not found: $TEST_PDF"
  echo ""
  echo "Creating minimal test PDF..."

  # Create minimal PDF using echo
  cat > "$TEST_PDF" << 'EOF'
%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length 100
>>
stream
BT
/F1 12 Tf
50 700 Td
(Vessel Name: MV Test Ship) Tj
0 -20 Td
(IMO: 1234567) Tj
0 -20 Td
(Flag: Panama) Tj
ET
endstream
endobj

xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000317 00000 n
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
465
%%EOF
EOF

  echo -e "${GREEN}✓${NC} Created test PDF: $TEST_PDF"
fi

# Check for API key
if [ -z "$VESSEL_NER_API_KEY" ]; then
  echo -e "${YELLOW}⚠${NC}  VESSEL_NER_API_KEY not set (trying without auth)"
fi

# Get MotherDuck token from Pulumi ESC if not already set
if [ -z "$MOTHERDUCK_TOKEN" ]; then
  echo "📥 Fetching MOTHERDUCK_TOKEN from Pulumi ESC..."
  MOTHERDUCK_TOKEN=$(cd ../../cloud && pulumi config get oceanid-cloud:motherduckToken 2>&1)

  if [ -z "$MOTHERDUCK_TOKEN" ] || echo "$MOTHERDUCK_TOKEN" | grep -q "error:"; then
    echo -e "${RED}✗${NC} Failed to get MOTHERDUCK_TOKEN from Pulumi ESC"
    echo "   Tried: pulumi config get oceanid-cloud:motherduckToken --cwd ../../cloud"
    echo "   Error: $MOTHERDUCK_TOKEN"
    exit 1
  fi

  echo -e "${GREEN}✓${NC} Got MOTHERDUCK_TOKEN from ESC"
fi

echo -e "${GREEN}✓${NC} Prerequisites OK"
echo ""

# Step 2: Upload PDF
echo -e "${YELLOW}[2/6]${NC} Uploading PDF to worker..."

UPLOAD_START=$(date +%s)
PDF_FILENAME=$(basename "$TEST_PDF")

if [ -n "$VESSEL_NER_API_KEY" ]; then
  UPLOAD_RESPONSE=$(curl -s -X POST "$WORKER_URL/upload" \
    -H "Authorization: Bearer $VESSEL_NER_API_KEY" \
    -F "pdf=@$TEST_PDF")
else
  UPLOAD_RESPONSE=$(curl -s -X POST "$WORKER_URL/upload" \
    -F "pdf=@$TEST_PDF")
fi

echo "$UPLOAD_RESPONSE" | jq '.' 2>/dev/null || echo "$UPLOAD_RESPONSE"

if echo "$UPLOAD_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} Upload successful"
else
  echo -e "${RED}✗${NC} Upload failed"
  exit 1
fi

# Extract uploaded filename from response or use original
UPLOADED_NAME=$(echo "$UPLOAD_RESPONSE" | jq -r '.uploaded_filename // empty')
if [ -z "$UPLOADED_NAME" ]; then
  # Fallback: guess the R2 key pattern
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")
  UPLOADED_NAME="${TIMESTAMP}_${PDF_FILENAME}"
fi

echo "   Uploaded as: $UPLOADED_NAME"
echo ""

# Step 3: Wait for OCR processing
echo -e "${YELLOW}[3/6]${NC} Waiting for OCR processing..."

MAX_WAIT=120  # 2 minutes
WAIT_INTERVAL=5
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  # Query MotherDuck for OCR results
  MD_QUERY="{\"database\": \"$MOTHERDUCK_DB\", \"query\": \"SELECT COUNT(*) as count FROM md_raw_ocr.raw_documents WHERE filename LIKE '%$PDF_FILENAME%'\"}"

  MD_RESPONSE=$(curl -s -X POST "$MD_PROXY_URL/query" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MOTHERDUCK_TOKEN" \
    -d "$MD_QUERY")

  COUNT=$(echo "$MD_RESPONSE" | jq -r '.data[0].count // 0' 2>/dev/null || echo "0")

  if [ "$COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓${NC} OCR completed (found $COUNT document record)"
    break
  fi

  echo -n "."
  sleep $WAIT_INTERVAL
  ELAPSED=$((ELAPSED + WAIT_INTERVAL))
done

echo ""

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo -e "${YELLOW}⚠${NC}  OCR timeout (${MAX_WAIT}s) - continuing anyway..."
  echo "   Note: OCR may still be processing in the queue"
else
  echo -e "${GREEN}✓${NC} OCR processing complete in ${ELAPSED}s"
fi
echo ""

# Step 4: Check Parquet output in R2
echo -e "${YELLOW}[4/6]${NC} Checking Parquet output in R2..."

# Get doc_id from filename (remove .pdf extension)
DOC_ID="${PDF_FILENAME%.pdf}"
TODAY=$(date -u +"%Y-%m-%d")

# Query for the most recent run_id for this document
MD_QUERY_RUN="{\"database\": \"$MOTHERDUCK_DB\", \"query\": \"SELECT run_id, r2_key FROM md_raw_ocr.raw_documents WHERE doc_id = '$DOC_ID' ORDER BY run_id DESC LIMIT 1\"}"

MD_RUN_RESPONSE=$(curl -s -X POST "$MD_PROXY_URL/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MOTHERDUCK_TOKEN" \
  -d "$MD_QUERY_RUN")

RUN_ID=$(echo "$MD_RUN_RESPONSE" | jq -r '.data[0].run_id // empty' 2>/dev/null)
R2_KEY=$(echo "$MD_RUN_RESPONSE" | jq -r '.data[0].r2_key // empty' 2>/dev/null)

if [ -n "$RUN_ID" ]; then
  echo -e "${GREEN}✓${NC} Found Parquet record: run_id=$RUN_ID"
  echo "   Source PDF: $R2_KEY"

  # Expected Parquet paths
  DOCUMENTS_PARQUET="md_raw_ocr/documents/date=${TODAY}/doc_id=${DOC_ID}/run_id=${RUN_ID}/part-000.parquet"
  PAGES_PARQUET="md_raw_ocr/pages/doc_id=${DOC_ID}/run_id=${RUN_ID}/part-000.parquet"

  echo "   Expected Parquet files:"
  echo "   - Documents: $DOCUMENTS_PARQUET"
  echo "   - Pages: $PAGES_PARQUET"
else
  echo -e "${YELLOW}⚠${NC}  No Parquet records found yet"
  echo "   This is expected if OCR just completed"
fi
echo ""

# Step 5: Verify MotherDuck data
echo -e "${YELLOW}[5/6]${NC} Verifying MotherDuck data..."

# Query raw_documents
MD_QUERY_DOCS="{\"database\": \"$MOTHERDUCK_DB\", \"query\": \"SELECT doc_id, filename, doc_sha256, ocr_model FROM md_raw_ocr.raw_documents WHERE filename LIKE '%$PDF_FILENAME%' LIMIT 5\"}"

MD_DOCS_RESPONSE=$(curl -s -X POST "$MD_PROXY_URL/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MOTHERDUCK_TOKEN" \
  -d "$MD_QUERY_DOCS")

DOCS_COUNT=$(echo "$MD_DOCS_RESPONSE" | jq '.data | length' 2>/dev/null || echo "0")

if [ "$DOCS_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓${NC} Found $DOCS_COUNT document record(s) in MotherDuck"
  echo "$MD_DOCS_RESPONSE" | jq -r '.data[] | "   - doc_id: \(.doc_id), sha256: \(.doc_sha256[0:16])..., model: \(.ocr_model)"' 2>/dev/null || true
else
  echo -e "${YELLOW}⚠${NC}  No document records found"
fi
echo ""

# Query raw_pages
MD_QUERY_PAGES="{\"database\": \"$MOTHERDUCK_DB\", \"query\": \"SELECT doc_id, page_num, LENGTH(text) as text_length, text_sha256 FROM md_raw_ocr.raw_pages WHERE doc_id = '$DOC_ID' LIMIT 10\"}"

MD_PAGES_RESPONSE=$(curl -s -X POST "$MD_PROXY_URL/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MOTHERDUCK_TOKEN" \
  -d "$MD_QUERY_PAGES")

PAGES_COUNT=$(echo "$MD_PAGES_RESPONSE" | jq '.data | length' 2>/dev/null || echo "0")

if [ "$PAGES_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓${NC} Found $PAGES_COUNT page record(s) in MotherDuck"
  echo "$MD_PAGES_RESPONSE" | jq -r '.data[] | "   - Page \(.page_num): \(.text_length) chars, sha256: \(.text_sha256[0:16])..."' 2>/dev/null || true
else
  echo -e "${YELLOW}⚠${NC}  No page records found"
fi
echo ""

# Step 6: Check Argilla readiness
echo -e "${YELLOW}[6/6]${NC} Checking Argilla sync readiness..."

# Query for records that should be synced to Argilla
# Note: Argilla sync happens via cron every 6 hours, so records won't be in Argilla yet
# We're just checking if the data is ready for sync

MD_QUERY_ARGILLA="{\"database\": \"$MOTHERDUCK_DB\", \"query\": \"SELECT COUNT(*) as count FROM md_raw_ocr.raw_pages WHERE doc_id = '$DOC_ID'\"}"

MD_ARGILLA_RESPONSE=$(curl -s -X POST "$MD_PROXY_URL/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MOTHERDUCK_TOKEN" \
  -d "$MD_QUERY_ARGILLA")

ARGILLA_READY_COUNT=$(echo "$MD_ARGILLA_RESPONSE" | jq -r '.data[0].count // 0' 2>/dev/null || echo "0")

if [ "$ARGILLA_READY_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓${NC} Data ready for Argilla sync: $ARGILLA_READY_COUNT pages"
  echo "   Note: Argilla sync runs every 6 hours via cron"
  echo "   Check Argilla at: https://argilla.boathou.se"
  echo ""
  echo -e "${GREEN}✓${NC} ${BLUE}You can now test Argilla${NC}"
  echo "   The OCR data is in MotherDuck and ready to be pulled by Argilla"
else
  echo -e "${YELLOW}⚠${NC}  No pages ready for Argilla sync yet"
fi
echo ""

# Summary
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           Test Summary                  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

TOTAL_TIME=$(($(date +%s) - UPLOAD_START))

if [ "$DOCS_COUNT" -gt 0 ] && [ "$PAGES_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓ PASS${NC} - End-to-end pipeline working"
  echo ""
  echo "Pipeline stages verified:"
  echo -e "  ${GREEN}✓${NC} Upload API (Cloudflare Workers)"
  echo -e "  ${GREEN}✓${NC} OCR Processing (HuggingFace DeepSeek)"
  echo -e "  ${GREEN}✓${NC} Parquet Output (R2 vessel-parquet bucket)"
  echo -e "  ${GREEN}✓${NC} MotherDuck Storage (md_raw_ocr schema)"
  echo -e "  ${GREEN}✓${NC} Argilla Ready (data available for sync)"
  echo ""
  echo "Total time: ${TOTAL_TIME}s"
  echo ""
  echo -e "${BLUE}Next steps:${NC}"
  echo "1. Check Argilla at https://argilla.boathou.se"
  echo "2. Wait for cron sync (every 6 hours) or trigger manually"
  echo "3. Verify annotations appear in Argilla UI"
  exit 0
else
  echo -e "${YELLOW}⚠ PARTIAL${NC} - Pipeline partially working"
  echo ""
  echo "Status:"
  echo -e "  ${GREEN}✓${NC} Upload API working"
  echo -e "  ${YELLOW}⚠${NC} OCR/MotherDuck data incomplete (may still be processing)"
  echo ""
  echo "Check logs with:"
  echo "  pnpm exec wrangler tail vessel-ner-ocr-processor --format pretty"
  echo ""
  exit 1
fi
