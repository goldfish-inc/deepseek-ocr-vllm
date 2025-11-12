#!/bin/bash
set -euo pipefail

# Deploy DeepSeek-OCR vLLM to Calypso (RTX 4090)
# Usage: ./infrastructure/calypso/deploy.sh

CALYPSO_HOST="neptune@192.168.2.110"
CALYPSO_PASSWORD="C0w5in\$pace"
CONTAINER_NAME="deepseek-ocr-vllm"
IMAGE_NAME="deepseek-ocr-vllm-rtx4090:latest"

echo "🚀 Deploying DeepSeek-OCR vLLM to Calypso (RTX 4090)..."
echo ""

# Step 1: Copy Dockerfile to Calypso
echo "📦 Step 1: Copying Dockerfile to Calypso..."
sshpass -p "${CALYPSO_PASSWORD}" scp -o StrictHostKeyChecking=no \
  infrastructure/calypso/Dockerfile.deepseek-ocr-rtx4090 \
  ${CALYPSO_HOST}:/home/neptune/Dockerfile.deepseek-ocr-rtx4090

echo "✅ Dockerfile copied"
echo ""

# Step 2: Build container on Calypso
echo "🔨 Step 2: Building Docker image on Calypso..."
echo "⏱️  This may take 5-10 minutes (downloading model weights)..."
sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} << 'ENDSSH'
  cd /home/neptune
  docker build -t deepseek-ocr-vllm-rtx4090:latest -f Dockerfile.deepseek-ocr-rtx4090 .
ENDSSH

echo "✅ Docker image built"
echo ""

# Step 3: Stop existing container (if running)
echo "🛑 Step 3: Stopping existing container (if any)..."
sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} << 'ENDSSH'
  docker stop deepseek-ocr-vllm 2>/dev/null || true
  docker rm deepseek-ocr-vllm 2>/dev/null || true
ENDSSH

echo "✅ Existing container stopped"
echo ""

# Step 4: Run new container
echo "▶️  Step 4: Starting new container with RTX 4090 optimizations..."
sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} << 'ENDSSH'
  docker run -d \
    --name deepseek-ocr-vllm \
    --gpus all \
    --restart unless-stopped \
    --shm-size 8g \
    -p 8000:8000 \
    -v /home/neptune/.cache/huggingface:/root/.cache/huggingface \
    -e VLLM_FLASH_ATTN_VERSION=2 \
    -e CUDA_VISIBLE_DEVICES=0 \
    deepseek-ocr-vllm-rtx4090:latest
ENDSSH

echo "✅ Container started"
echo ""

# Step 5: Wait for container to be ready
echo "⏳ Step 5: Waiting for vLLM to initialize (30 seconds)..."
sleep 30

# Step 6: Verify deployment
echo "🔍 Step 6: Verifying deployment..."
echo ""

echo "Container status:"
sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} \
  'docker ps | grep deepseek-ocr-vllm'
echo ""

echo "Container logs (last 20 lines):"
sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} \
  'docker logs deepseek-ocr-vllm --tail 20'
echo ""

echo "Health check:"
sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} \
  'curl -s http://localhost:8000/health || echo "Health check failed"'
echo ""

echo "GPU memory usage:"
sshpass -p "${CALYPSO_PASSWORD}" ssh -o StrictHostKeyChecking=no ${CALYPSO_HOST} \
  'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits'
echo ""

echo "✅ Deployment complete!"
echo ""
echo "📊 Access vLLM API at: http://192.168.2.110:8000"
echo "📖 API docs: http://192.168.2.110:8000/docs"
echo "🏥 Health check: http://192.168.2.110:8000/health"
echo ""
echo "📝 To view logs:"
echo "   ssh neptune@192.168.2.110 'docker logs -f deepseek-ocr-vllm'"
echo ""
echo "🛑 To stop:"
echo "   ssh neptune@192.168.2.110 'docker stop deepseek-ocr-vllm'"
echo ""
