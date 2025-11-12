# Quick Start: DeepSeek-OCR vLLM on RTX 4090

Get DeepSeek-OCR running on Calypso (RTX 4090) in under 10 minutes.

## Prerequisites

- ✅ Calypso node with RTX 4090 (192.168.2.110)
- ✅ NVIDIA drivers installed (>= 535)
- ✅ Docker installed with GPU support
- ✅ `sshpass` installed on deployment machine

## One-Command Deployment

From your local machine (or any node with access to Calypso):

```bash
cd /home/neptune/Developer/deepseek-ocr-vllm
./infrastructure/calypso/deploy.sh
```

This will:
1. Copy Dockerfile to Calypso
2. Build Docker image with vLLM + DeepSeek-OCR
3. Stop any existing container
4. Start new container with RTX 4090 optimizations
5. Verify deployment

**Expected time:** 5-10 minutes (mostly downloading model weights)

## Manual Deployment (Alternative)

If you prefer to run commands manually:

### 1. SSH to Calypso

```bash
ssh neptune@192.168.2.110
# Password: C0w5in$pace
```

### 2. Create Dockerfile

```bash
cd /home/neptune
cat > Dockerfile.deepseek-ocr-rtx4090 << 'EOF'
FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime

RUN apt-get update && apt-get install -y git curl build-essential && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    vllm==0.6.4.post1 \
    transformers>=4.45.0 \
    pillow \
    sentencepiece

RUN python -c "from transformers import AutoModel; \
    AutoModel.from_pretrained('deepseek-ai/DeepSeek-OCR', trust_remote_code=True)"

ENV VLLM_FLASH_ATTN_VERSION=2
EXPOSE 8000

CMD ["vllm", "serve", "deepseek-ai/DeepSeek-OCR", \
     "--logits_processors", "vllm.model_executor.models.deepseek_ocr:NGramPerReqLogitsProcessor", \
     "--no-enable-prefix-caching", \
     "--mm-processor-cache-gb", "0", \
     "--gpu-memory-utilization", "0.90", \
     "--max-model-len", "4096", \
     "--max-num-batched-tokens", "2048", \
     "--max-num-seqs", "4", \
     "--host", "0.0.0.0", \
     "--port", "8000"]
EOF
```

### 3. Build Image

```bash
docker build -t deepseek-ocr-vllm-rtx4090:latest -f Dockerfile.deepseek-ocr-rtx4090 .
```

### 4. Run Container

```bash
docker stop deepseek-ocr-vllm 2>/dev/null || true
docker rm deepseek-ocr-vllm 2>/dev/null || true

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
```

### 5. Verify

```bash
# Wait for startup (30 seconds)
sleep 30

# Check health
curl http://localhost:8000/health

# Check model loaded
curl http://localhost:8000/v1/models | jq

# Check GPU memory
nvidia-smi
```

## Verification

Run the automated test suite:

```bash
./infrastructure/calypso/test-vllm.sh
```

Expected output:
```
✅ Health check passed
✅ GPU memory usage is healthy (18000MB / 24000MB)
✅ No errors in recent logs
✅ Inference test passed
✅ All tests passed!
```

## API Usage

### Health Check

```bash
curl http://192.168.2.110:8000/health
```

### Text-Only Test

```bash
curl -X POST http://192.168.2.110:8000/v1/chat/completions \
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
  }'
```

### PDF OCR Test

```bash
curl -X POST http://192.168.2.110:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-ai/DeepSeek-OCR",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "<|grounding|>Convert this document to markdown."
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/sample.pdf"
            }
          }
        ]
      }
    ],
    "max_tokens": 2048,
    "temperature": 0
  }'
```

## Monitoring

### View Logs

```bash
ssh neptune@192.168.2.110 'docker logs -f deepseek-ocr-vllm'
```

### Check GPU Usage

```bash
ssh neptune@192.168.2.110 'watch -n 1 nvidia-smi'
```

### Check Container Status

```bash
ssh neptune@192.168.2.110 'docker ps | grep deepseek'
```

## Troubleshooting

### Container won't start

```bash
# Check logs for errors
docker logs deepseek-ocr-vllm

# Common issues:
# 1. NVIDIA drivers not installed
nvidia-smi  # Should show GPU

# 2. nvidia-container-toolkit not installed
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

### Out of Memory (OOM)

```bash
# Edit Dockerfile and reduce max-model-len:
# Change: "--max-model-len", "4096"
# To:     "--max-model-len", "2048"

# Rebuild and restart
docker build -t deepseek-ocr-vllm-rtx4090:latest -f Dockerfile.deepseek-ocr-rtx4090 .
docker stop deepseek-ocr-vllm && docker rm deepseek-ocr-vllm
# ... run docker run command again
```

### Slow Performance

```bash
# Check GPU utilization (should be 90-100% during inference)
nvidia-smi

# Check Flash Attention is enabled
docker logs deepseek-ocr-vllm 2>&1 | grep -i "flash attention"
# Should see: "Using Flash Attention v2"
```

## Stopping the Service

```bash
ssh neptune@192.168.2.110 'docker stop deepseek-ocr-vllm'
```

## Restarting the Service

```bash
ssh neptune@192.168.2.110 'docker start deepseek-ocr-vllm'
```

## Uninstalling

```bash
ssh neptune@192.168.2.110 << 'ENDSSH'
  docker stop deepseek-ocr-vllm
  docker rm deepseek-ocr-vllm
  docker rmi deepseek-ocr-vllm-rtx4090:latest
  rm -rf ~/.cache/huggingface/hub/models--deepseek-ai--DeepSeek-OCR
ENDSSH
```

## Next Steps

1. **Production deployment**: See [deepseek-ocr-vllm-rtx4090.md](./deepseek-ocr-vllm-rtx4090.md) for advanced configuration
2. **Cloudflare Worker integration**: Update Worker to use RTX 4090 endpoint
3. **Monitoring**: Add to Grafana Cloud dashboards
4. **Comparison**: Read [GPU_COMPARISON.md](../GPU_COMPARISON.md) for RTX 4090 vs DGX Spark

## Reference

- Full deployment guide: [deepseek-ocr-vllm-rtx4090.md](./deepseek-ocr-vllm-rtx4090.md)
- Comparison with DGX Spark: [GPU_COMPARISON.md](../GPU_COMPARISON.md)
- DGX Spark deployment: [../spark/deepseek-ocr-vllm.md](../spark/deepseek-ocr-vllm.md)
