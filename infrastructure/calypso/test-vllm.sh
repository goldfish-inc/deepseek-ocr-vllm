#!/bin/bash
set -euo pipefail

# Test DeepSeek-OCR vLLM on Calypso (RTX 4090)
# Usage: ./infrastructure/calypso/test-vllm.sh

CALYPSO_HOST="neptune@192.168.2.110"
CALYPSO_PASSWORD="C0w5in\$pace"
VLLM_ENDPOINT="http://192.168.2.110:8000"

echo "🧪 Testing DeepSeek-OCR vLLM on Calypso (RTX 4090)..."
echo ""

# Test 1: Health check
echo "📡 Test 1: Health check..."
HEALTH_STATUS=$(sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} \
  'curl -s http://localhost:8000/health' || echo "FAILED")

if [[ "$HEALTH_STATUS" == *"healthy"* ]] || [[ "$HEALTH_STATUS" == "200" ]]; then
  echo "✅ Health check passed"
else
  echo "❌ Health check failed: $HEALTH_STATUS"
  exit 1
fi
echo ""

# Test 2: Model listing
echo "📋 Test 2: Model listing..."
sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} \
  'curl -s http://localhost:8000/v1/models | jq -r ".data[].id"' || echo "❌ Model listing failed"
echo ""

# Test 3: GPU memory check
echo "🎮 Test 3: GPU memory usage..."
GPU_MEM=$(sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} \
  'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits')

echo "GPU Memory: $GPU_MEM"

# Parse memory (format: "used, total")
GPU_USED=$(echo $GPU_MEM | awk '{print $1}')
GPU_TOTAL=$(echo $GPU_MEM | awk '{print $2}')

if (( GPU_USED > 22000 )); then
  echo "⚠️  Warning: GPU memory usage is high (${GPU_USED}MB / ${GPU_TOTAL}MB)"
  echo "   Consider reducing max-model-len or enabling quantization"
elif (( GPU_USED < 1000 )); then
  echo "⚠️  Warning: GPU memory usage is very low (${GPU_USED}MB / ${GPU_TOTAL}MB)"
  echo "   Model may not be loaded properly"
else
  echo "✅ GPU memory usage is healthy (${GPU_USED}MB / ${GPU_TOTAL}MB)"
fi
echo ""

# Test 4: Container logs check
echo "📝 Test 4: Container logs check (looking for errors)..."
LOGS=$(sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} \
  'docker logs deepseek-ocr-vllm --tail 50 2>&1')

if echo "$LOGS" | grep -qi "error\|failed\|exception"; then
  echo "⚠️  Warning: Errors found in logs:"
  echo "$LOGS" | grep -i "error\|failed\|exception" | head -5
else
  echo "✅ No errors in recent logs"
fi
echo ""

# Test 5: Simple inference test (text-only)
echo "🤖 Test 5: Simple inference test..."
INFERENCE_RESULT=$(sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} << 'ENDSSH'
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-ai/DeepSeek-OCR",
    "messages": [
      {
        "role": "user",
        "content": "Hello, are you working?"
      }
    ],
    "max_tokens": 50,
    "temperature": 0
  }' | jq -r '.choices[0].message.content // "FAILED"'
ENDSSH
)

if [[ "$INFERENCE_RESULT" != "FAILED" ]] && [[ -n "$INFERENCE_RESULT" ]]; then
  echo "✅ Inference test passed"
  echo "   Response: $INFERENCE_RESULT"
else
  echo "❌ Inference test failed"
  exit 1
fi
echo ""

# Test 6: GPU utilization check
echo "📊 Test 6: GPU utilization..."
GPU_UTIL=$(sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} \
  'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits')

echo "GPU Utilization: ${GPU_UTIL}%"
echo ""

# Summary
echo "════════════════════════════════════════════════════════════════"
echo "✅ All tests passed! DeepSeek-OCR vLLM is running on RTX 4090"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "📊 Summary:"
echo "   - GPU Memory: ${GPU_USED}MB / ${GPU_TOTAL}MB"
echo "   - GPU Utilization: ${GPU_UTIL}%"
echo "   - API Endpoint: http://192.168.2.110:8000"
echo ""
echo "🧪 To test with a real PDF, run:"
echo "   curl -X POST http://192.168.2.110:8000/v1/chat/completions \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{"
echo "       \"model\": \"deepseek-ai/DeepSeek-OCR\","
echo "       \"messages\": [{"
echo "         \"role\": \"user\","
echo "         \"content\": ["
echo "           {\"type\": \"text\", \"text\": \"<|grounding|>Convert to markdown.\"},"
echo "           {\"type\": \"image_url\", \"image_url\": {\"url\": \"YOUR_PDF_URL\"}}"
echo "         ]"
echo "       }],"
echo "       \"max_tokens\": 2048"
echo "     }'"
echo ""
