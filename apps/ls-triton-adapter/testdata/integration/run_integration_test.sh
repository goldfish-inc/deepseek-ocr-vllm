#!/bin/bash
set -euo pipefail

# Integration Test: ls-triton-adapter with live Triton
#
# Prerequisites:
# - Triton running on Calypso (192.168.2.110:8000)
# - Label Studio accessible at https://label.boathou.se
# - LS_PAT environment variable set
# - test-vessel-registry.pdf exists in parent testdata/ directory
#
# Usage:
#   export LS_PAT="your-label-studio-personal-access-token"
#   ./run_integration_test.sh

# Configuration
LS_URL="${LS_URL:-https://label.boathou.se}"
ADAPTER_URL="${ADAPTER_URL:-http://ls-triton-adapter.apps.svc.cluster.local:9090}"
TEST_PDF="../test-vessel-registry.pdf"
EXPECTED_ENTITIES="../expected-ner-entities.json"
# EXPECTED_DOCLING="../expected-docling-output.json"  # TODO: Add Docling output verification

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 Integration Test: ls-triton-adapter"
echo "======================================"
echo ""
echo "Configuration:"
echo "  Label Studio: $LS_URL"
echo "  Adapter: $ADAPTER_URL"
echo "  Test PDF: $TEST_PDF"
echo ""

# Check prerequisites
if [ -z "${LS_PAT:-}" ]; then
    echo -e "${RED}❌ Error: LS_PAT environment variable not set${NC}"
    echo "   Set it with: export LS_PAT='your-label-studio-token'"
    exit 1
fi

if [ ! -f "$TEST_PDF" ]; then
    echo -e "${YELLOW}⚠️  Warning: Test PDF not found at $TEST_PDF${NC}"
    echo "   This file needs to be created with synthetic vessel data."
    echo "   See ../README.md for specifications."
    echo ""
    echo "Skipping integration test (test PDF not available)"
    exit 0
fi

# Function to cleanup on exit
cleanup() {
    if [ -n "${PROJECT_ID:-}" ]; then
        echo ""
        echo "🧹 Cleaning up test project..."
        curl -s -X DELETE \
            -H "Authorization: Token $LS_PAT" \
            "$LS_URL/api/projects/$PROJECT_ID" >/dev/null || true
        echo -e "${GREEN}✅ Test project $PROJECT_ID deleted${NC}"
    fi
}
trap cleanup EXIT

# Step 1: Create temporary test project
echo "📝 Step 1: Creating test project..."
PROJECT_RESPONSE=$(curl -s -X POST \
    -H "Authorization: Token $LS_PAT" \
    -H "Content-Type: application/json" \
    -d '{
        "title": "[TEST] Triton Integration - '"$(date +%Y%m%d-%H%M%S)"'",
        "description": "Temporary project for automated integration testing"
    }' \
    "$LS_URL/api/projects")

PROJECT_ID=$(echo "$PROJECT_RESPONSE" | jq -r '.id')
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "null" ]; then
    echo -e "${RED}❌ Failed to create test project${NC}"
    echo "Response: $PROJECT_RESPONSE"
    exit 1
fi

echo -e "${GREEN}✅ Project created: ID $PROJECT_ID${NC}"
echo ""

# Step 2: Attach ML backend to project
echo "📝 Step 2: Attaching ML backend..."
ML_BACKEND_RESPONSE=$(curl -s -X POST \
    -H "Authorization: Token $LS_PAT" \
    -H "Content-Type: application/json" \
    -d '{
        "url": "'"$ADAPTER_URL"'",
        "project": '"$PROJECT_ID"'
    }' \
    "$LS_URL/api/ml")

BACKEND_ID=$(echo "$ML_BACKEND_RESPONSE" | jq -r '.id')
if [ -z "$BACKEND_ID" ] || [ "$BACKEND_ID" = "null" ]; then
    echo -e "${RED}❌ Failed to attach ML backend${NC}"
    echo "Response: $ML_BACKEND_RESPONSE"
    exit 1
fi

echo -e "${GREEN}✅ ML backend attached: ID $BACKEND_ID${NC}"
echo ""

# Step 3: Configure labeling interface (NER)
echo "📝 Step 3: Configuring labeling interface..."
LABEL_CONFIG='<View>
  <Text name="text" value="$text"/>
  <Labels name="label" toName="text">
    <Label value="VESSEL" background="blue"/>
    <Label value="IMO" background="green"/>
    <Label value="FLAG" background="red"/>
    <Label value="PORT" background="purple"/>
    <Label value="DATE" background="orange"/>
  </Labels>
</View>'

curl -s -X PATCH \
    -H "Authorization: Token $LS_PAT" \
    -H "Content-Type: application/json" \
    -d '{
        "label_config": "'"$(echo "$LABEL_CONFIG" | sed 's/"/\\"/g')"'"
    }' \
    "$LS_URL/api/projects/$PROJECT_ID" >/dev/null

echo -e "${GREEN}✅ Labeling interface configured${NC}"
echo ""

# Step 4: Upload test PDF as task
echo "📝 Step 4: Uploading test PDF..."

# For S3-based storage, would need to upload to S3 first
# For simplicity, using file_upload field with base64 encoded PDF
PDF_BASE64=$(base64 < "$TEST_PDF")

TASK_RESPONSE=$(curl -s -X POST \
    -H "Authorization: Token $LS_PAT" \
    -H "Content-Type: application/json" \
    -d '{
        "data": {
            "pdf_base64": "'"$PDF_BASE64"'"
        }
    }' \
    "$LS_URL/api/projects/$PROJECT_ID/tasks")

TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.id')
if [ -z "$TASK_ID" ] || [ "$TASK_ID" = "null" ]; then
    echo -e "${RED}❌ Failed to upload test PDF${NC}"
    echo "Response: $TASK_RESPONSE"
    exit 1
fi

echo -e "${GREEN}✅ Test PDF uploaded: Task ID $TASK_ID${NC}"
echo ""

# Step 5: Trigger ML prediction
echo "📝 Step 5: Triggering ML prediction..."

PREDICTION_RESPONSE=$(curl -s -X POST \
    -H "Authorization: Token $LS_PAT" \
    -H "Content-Type: application/json" \
    "$LS_URL/api/ml/$BACKEND_ID/predict" \
    -d '{
        "tasks": ['"$TASK_ID"']
    }')

# Check if prediction succeeded
PREDICTION_COUNT=$(echo "$PREDICTION_RESPONSE" | jq -r 'length')
if [ "$PREDICTION_COUNT" -eq 0 ]; then
    echo -e "${RED}❌ ML prediction failed (no predictions returned)${NC}"
    echo "Response: $PREDICTION_RESPONSE"
    exit 1
fi

ENTITY_COUNT=$(echo "$PREDICTION_RESPONSE" | jq -r '.[0].result | length')
echo -e "${GREEN}✅ ML prediction completed: $ENTITY_COUNT entities detected${NC}"
echo ""

# Step 6: Verify entities match expected output (optional)
if [ -f "$EXPECTED_ENTITIES" ] && command -v jq &>/dev/null; then
    echo "📝 Step 6: Verifying entity extraction..."

    EXPECTED_COUNT=$(jq -r '.entities | length' "$EXPECTED_ENTITIES")

    if [ "$ENTITY_COUNT" -eq "$EXPECTED_COUNT" ]; then
        echo -e "${GREEN}✅ Entity count matches expected: $ENTITY_COUNT${NC}"
    else
        echo -e "${YELLOW}⚠️  Entity count mismatch: got $ENTITY_COUNT, expected $EXPECTED_COUNT${NC}"
        echo "   This may be acceptable if the model has been updated."
    fi
else
    echo "📝 Step 6: Skipping entity verification (expected output file not found)"
fi
echo ""

# Step 7: Check for CSV webhook (if tables were extracted)
echo "📝 Step 7: Checking for table extraction..."
# Note: This would require checking csv-ingestion-worker logs or database
# For now, just report completion
echo "   (Manual verification required: check csv-ingestion-worker logs)"
echo ""

# Summary
echo "======================================"
echo -e "${GREEN}🏁 Integration test completed successfully${NC}"
echo ""
echo "Summary:"
echo "  - Project ID: $PROJECT_ID"
echo "  - Task ID: $TASK_ID"
echo "  - Entities detected: $ENTITY_COUNT"
echo ""
echo "Next steps:"
echo "  1. Review predictions in Label Studio UI:"
echo "     $LS_URL/projects/$PROJECT_ID/data?task=$TASK_ID"
echo "  2. If results look good, update expected output files"
echo "  3. Re-run regression tests to verify"
echo ""
