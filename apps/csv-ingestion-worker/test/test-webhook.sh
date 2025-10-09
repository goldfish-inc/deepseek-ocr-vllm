#!/bin/bash

# Test script for CSV ingestion worker
# Simulates a Label Studio webhook with real RFMO vessel data

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🚀 Testing CSV Ingestion Worker with RFMO Data"
echo "============================================="

# Copy test file to MinIO
echo -e "${YELLOW}Uploading test file to MinIO...${NC}"
docker exec csv-worker-minio mkdir -p /data/test-bucket 2>/dev/null || true
docker cp /Users/rt/Developer/oceanid/data/raw/vessels/RFMO/raw/NEAFC_vessels_2025-08-26.csv csv-worker-minio:/data/test-bucket/neafc-test.csv

# Create webhook payload with timestamp-based task ID
TASK_ID=$(date +%s)
WEBHOOK_PAYLOAD=$(cat <<EOF
{
  "action": "TASK_CREATED",
  "task": {
    "id": $TASK_ID,
    "data": {
      "csv_url": "http://minio:9000/test-bucket/neafc-test.csv",
      "meta": {
        "source_type": "RFMO",
        "source_name": "NEAFC",
        "org_id": "neafc",
        "doc_type": "vessel_registry"
      }
    }
  },
  "project": {
    "id": 1,
    "title": "RFMO Vessel Registry"
  }
}
EOF
)

# Send webhook to worker
echo -e "${YELLOW}Sending webhook to CSV worker...${NC}"
RESPONSE=$(curl -s -X POST http://localhost:8080/webhook \
  -H "Content-Type: application/json" \
  -d "$WEBHOOK_PAYLOAD")

echo -e "${GREEN}Response: $RESPONSE${NC}"

# Wait for processing
echo -e "${YELLOW}Waiting for processing (5 seconds)...${NC}"
sleep 5

# Check database for results
echo -e "${YELLOW}Checking database for extracted data...${NC}"
docker exec csv-worker-db psql -U postgres -d oceanid_test -c "
SELECT
    COUNT(*) as total_cells,
    COUNT(CASE WHEN needs_review THEN 1 END) as needs_review,
    ROUND(AVG(confidence)::numeric, 3) as avg_confidence,
    ROUND(MIN(confidence)::numeric, 3) as min_confidence,
    ROUND(MAX(confidence)::numeric, 3) as max_confidence
FROM stage.csv_extractions
WHERE document_id = (SELECT MAX(id) FROM stage.documents);
"

# Show sample of extracted data
echo -e "${YELLOW}Sample of extracted data:${NC}"
docker exec csv-worker-db psql -U postgres -d oceanid_test -c "
SELECT
    row_index,
    column_name,
    SUBSTRING(raw_value, 1, 30) as raw_value,
    SUBSTRING(cleaned_value, 1, 30) as cleaned_value,
    confidence,
    needs_review
FROM stage.csv_extractions
WHERE document_id = (SELECT MAX(id) FROM stage.documents)
ORDER BY row_index, column_name
LIMIT 10;
"

# Show applied rules
echo -e "${YELLOW}Rules applied:${NC}"
docker exec csv-worker-db psql -U postgres -d oceanid_test -c "
SELECT DISTINCT
    unnest(rule_chain) as rule_id,
    r.rule_name,
    r.rule_type
FROM stage.csv_extractions e,
     stage.cleaning_rules r
WHERE document_id = (SELECT MAX(id) FROM stage.documents)
  AND r.id = ANY(e.rule_chain)
ORDER BY rule_id
LIMIT 10;
"

# Show processing stats
echo -e "${YELLOW}Processing statistics:${NC}"
docker exec csv-worker-db psql -U postgres -d oceanid_test -c "
SELECT
    d.file_name,
    l.rows_processed,
    l.confidence_avg,
    l.processing_status,
    EXTRACT(EPOCH FROM (l.completed_at - l.started_at)) as processing_seconds
FROM stage.document_processing_log l
JOIN stage.documents d ON l.document_id = d.id
WHERE l.document_id = (SELECT MAX(id) FROM stage.documents);
"

echo -e "${GREEN}✅ Test completed!${NC}"
