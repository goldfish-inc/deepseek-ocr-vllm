#!/bin/bash
set -e

echo "🚀 NER Model Deployment Script"
echo "==============================="

# Configuration
MODEL_DIR=${1:-"models/ner-distilbert"}
TRITON_HOST=${2:-"192.168.2.110"}
TRITON_USER=${3:-"neptune"}
TRITON_MODELS_DIR="/models"

if [ ! -d "$MODEL_DIR" ]; then
    echo "❌ Model directory not found: $MODEL_DIR"
    exit 1
fi

echo ""
echo "📋 Deployment Configuration:"
echo "  Model: $MODEL_DIR"
echo "  Triton Host: $TRITON_HOST"
echo "  Triton User: $TRITON_USER"
echo ""

# Step 1: Export to ONNX
echo "Step 1: Exporting to ONNX..."
python export_onnx.py \
    --model "$MODEL_DIR" \
    --output triton-models/ner-distilbert/1/model.onnx

if [ $? -ne 0 ]; then
    echo "❌ ONNX export failed"
    exit 1
fi
echo "✅ ONNX export complete"
echo ""

# Step 2: Copy Triton config
echo "Step 2: Creating Triton config..."
cp config.pbtxt.template triton-models/ner-distilbert/config.pbtxt
echo "✅ Config created"
echo ""

# Step 3: Deploy to Triton
echo "Step 3: Deploying to Triton server..."
echo "  Removing old model..."
sshpass -p 'C0w5in$pace' ssh -o StrictHostKeyChecking=no \
    ${TRITON_USER}@${TRITON_HOST} \
    "rm -rf ${TRITON_MODELS_DIR}/ner-distilbert"

echo "  Copying new model..."
sshpass -p 'C0w5in$pace' scp -r -o StrictHostKeyChecking=no \
    triton-models/ner-distilbert \
    ${TRITON_USER}@${TRITON_HOST}:${TRITON_MODELS_DIR}/

echo "  Restarting Triton..."
sshpass -p 'C0w5in$pace' ssh -o StrictHostKeyChecking=no \
    ${TRITON_USER}@${TRITON_HOST} \
    "docker restart triton-server"

echo "  Waiting for Triton to restart..."
sleep 10

# Step 4: Verify deployment
echo ""
echo "Step 4: Verifying deployment..."
HEALTH=$(curl -s http://${TRITON_HOST}:8000/v2/health/ready)
if echo "$HEALTH" | grep -q "true\|ready"; then
    echo "✅ Triton health check passed"
else
    echo "⚠️  Triton health check failed: $HEALTH"
fi

MODEL_INFO=$(curl -s http://${TRITON_HOST}:8000/v2/models/ner-distilbert)
if echo "$MODEL_INFO" | grep -q '"name":"ner-distilbert"'; then
    echo "✅ NER model loaded successfully"
    echo ""
    echo "Model info:"
    echo "$MODEL_INFO" | jq '.'
else
    echo "❌ Model not loaded. Response: $MODEL_INFO"
    exit 1
fi

echo ""
echo "======================================"
echo "🎉 Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Test predictions:"
echo "   cd ../ls-triton-adapter"
echo "   export DEFAULT_MODEL=ner-distilbert"
echo "   ./integration_test.sh"
echo ""
echo "2. Update cluster config:"
echo "   clusters/tethys/apps/label-studio-release.yaml"
echo "   DEFAULT_MODEL: ner-distilbert"
echo ""
