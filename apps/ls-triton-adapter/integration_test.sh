#!/bin/bash
set -e

echo "🧪 Integration Test: ls-triton-adapter"
echo "======================================"

# Test configuration
export LISTEN_ADDR="${LISTEN_ADDR:-127.0.0.1:8090}"
export TRITON_BASE_URL="${TRITON_BASE_URL:-http://192.168.2.110:8000}"  # Direct access to Calypso Triton
export DOCUMENT_EXTRACTION_URL="${DOCUMENT_EXTRACTION_URL:-http://192.168.2.110:8080}"  # Fallback HTTP extractor
export DEFAULT_MODEL="${DEFAULT_MODEL:-distilbert}"  # Actual model name on Triton
export TRITON_MODEL_NAME="${TRITON_MODEL_NAME:-ner-distilbert}"  # NER model name on Triton
export NER_LABELS="${NER_LABELS:-[\"O\",\"VESSEL\",\"HS_CODE\",\"PORT\",\"SPECIES\",\"IMO\",\"FLAG\",\"RISK_LEVEL\",\"DATE\"]}"

# Triton Docling integration (enabled by default to test the feature)
export TRITON_DOCLING_ENABLED="${TRITON_DOCLING_ENABLED:-true}"

# Optional: S3 configuration for file_upload testing (not tested in this script)
# export S3_BUCKET="${S3_BUCKET}"
# export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}"
# export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}"

# Optional: Set CF Access credentials from environment if available
# export CF_ACCESS_CLIENT_ID="${CF_ACCESS_CLIENT_ID}"
# export CF_ACCESS_CLIENT_SECRET="${CF_ACCESS_CLIENT_SECRET}"

echo ""
echo "📋 Configuration:"
echo "  Listen: $LISTEN_ADDR"
echo "  Triton: $TRITON_BASE_URL"
echo "  Document Extraction: $DOCUMENT_EXTRACTION_URL"
echo "  Model: $DEFAULT_MODEL"
echo "  Triton Model: $TRITON_MODEL_NAME"
echo "  Docling Enabled: $TRITON_DOCLING_ENABLED"
echo ""

# Build the service
echo "🔨 Building service..."
go build -o ./ls-triton-adapter .
echo "✅ Build successful"
echo ""

# Start service in background
echo "🚀 Starting service..."
./ls-triton-adapter &
SERVER_PID=$!
echo "  PID: $SERVER_PID"

# Wait for service to start
echo "⏳ Waiting for service to initialize..."
sleep 3

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."
    kill $SERVER_PID 2>/dev/null || true
    rm -f ./ls-triton-adapter
}
trap cleanup EXIT

# Test 1: Health check
echo ""
echo "Test 1: Health Check"
echo "--------------------"
HEALTH_RESPONSE=$(curl -s http://127.0.0.1:8090/health)
echo "Response: $HEALTH_RESPONSE"
if echo "$HEALTH_RESPONSE" | grep -q '"ok":true'; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi

# Test 2: Setup endpoint (Label Studio ML Backend)
echo ""
echo "Test 2: Setup Endpoint"
echo "----------------------"
SETUP_RESPONSE=$(curl -s http://127.0.0.1:8090/setup)
echo "Response: $SETUP_RESPONSE"
if echo "$SETUP_RESPONSE" | grep -q 'model_version'; then
    echo "✅ Setup endpoint working"
else
    echo "❌ Setup endpoint failed"
    exit 1
fi

# Test 3: Predict endpoint with sample vessel text
echo ""
echo "Test 3: Prediction Endpoint"
echo "---------------------------"
SAMPLE_TEXT="VESSEL: Arctic Explorer IMO: 1234567 FLAG: Norway PORT: Bergen SPECIES: Tuna"

PREDICT_PAYLOAD=$(cat <<EOF
{
    "text": "$SAMPLE_TEXT",
    "model": "$DEFAULT_MODEL",
    "task": "ner"
}
EOF
)

echo "Input text: $SAMPLE_TEXT"
echo ""
echo "Sending prediction request..."

# Note: This will fail if Cloudflare Access credentials are not set
# or if Triton endpoint is not accessible
PREDICT_RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$PREDICT_PAYLOAD" \
    http://127.0.0.1:8090/predict 2>&1)

echo "Response:"
echo "$PREDICT_RESPONSE" | jq '.' 2>/dev/null || echo "$PREDICT_RESPONSE"

# Check if response is valid JSON
if echo "$PREDICT_RESPONSE" | jq '.' >/dev/null 2>&1; then
    echo "✅ Valid JSON response"

    # Check if response has expected structure
    if echo "$PREDICT_RESPONSE" | jq -e '.result' >/dev/null 2>&1; then
        echo "✅ Response has 'result' field"

        ENTITY_COUNT=$(echo "$PREDICT_RESPONSE" | jq '.result | length')
        echo "  Entities found: $ENTITY_COUNT"

        if [ "$ENTITY_COUNT" -gt 0 ]; then
            echo "✅ Predictions generated successfully!"
            echo ""
            echo "Sample entities:"
            echo "$PREDICT_RESPONSE" | jq '.result[0:3]' 2>/dev/null || true
        else
            echo "⚠️  No entities predicted (may be expected if Triton returned all 'O' labels)"
        fi
    else
        echo "⚠️  Response structure differs from expected (check if error occurred)"
    fi
else
    echo "❌ Invalid JSON response or error occurred"
    echo "   This may indicate:"
    echo "   - Missing Cloudflare Access credentials"
    echo "   - Triton endpoint unavailable"
    echo "   - Network connectivity issues"
fi

echo ""
echo "======================================"
echo "🏁 Integration test completed"
echo ""
echo "Next steps:"
echo "1. Verify Cloudflare Access credentials are configured"
echo "2. Test with live Triton endpoint"
echo "3. Deploy updated image to cluster"
