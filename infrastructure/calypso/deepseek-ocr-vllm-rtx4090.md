# DeepSeek-OCR vLLM Deployment on RTX 4090 (Calypso)

Deploy DeepSeek-OCR with vLLM on Calypso (RTX 4090, 24GB VRAM) with memory optimizations.

## Architecture

```
PDF Upload → Cloudflare Worker → Calypso (192.168.2.110)
                                      ↓
                            vLLM + DeepSeek-OCR (24GB VRAM optimized)
                                      ↓
                         OCR Results → Parquet → R2 → MotherDuck
```

## Hardware Specs

**Calypso:**
- IP: `192.168.2.110` (LAN)
- User: `neptune`
- Password: `C0w5in$pace`
- GPU: NVIDIA RTX 4090 (16,384 CUDA cores)
- VRAM: **24 GB GDDR6X** (vs DGX Spark 128GB)
- Driver: NVIDIA >= 535 + CUDA 12.x

## Key Differences from DGX Spark

| Aspect | DGX Spark (Blackwell) | RTX 4090 (Calypso) |
|--------|----------------------|-------------------|
| VRAM | 128 GB unified | **24 GB** |
| Architecture | Grace Blackwell | Ada Lovelace |
| Container | NGC PyTorch 25.02-py3 | Standard PyTorch + CUDA 12.x |
| Batch Size | Large (no constraints) | **Small (VRAM limited)** |
| PDF Processing | Parallel (all pages) | **Sequential or reduced resolution** |
| Performance | ~2500 tokens/sec | **~800-1200 tokens/sec** |
| Flash Attention | v2 (Blackwell) | **v2 (Ada compatible)** |

## Container Selection

**Use Standard PyTorch Container for RTX 4090:**
```bash
# PyTorch 2.3.0 + CUDA 12.1 (RTX 4090 compatible)
pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime
```

**Why NOT NGC Container:**
- ❌ NGC PyTorch 25.02-py3 is optimized for Blackwell architecture
- ❌ Blackwell-specific features won't benefit RTX 4090
- ✅ Standard PyTorch container is lighter and proven on Ada Lovelace

## Memory Optimization Strategy

### 1. Model Quantization (Recommended)
Use **4-bit quantization** (AWQ or GPTQ) to reduce VRAM from ~20GB → ~6GB:
```bash
# Option A: Use pre-quantized model if available
model_name="deepseek-ai/DeepSeek-OCR-AWQ"

# Option B: Quantize on-the-fly (slower first load)
--quantization awq
```

### 2. vLLM Memory Settings
```bash
--gpu-memory-utilization 0.90    # Use 90% of 24GB = 21.6GB
--max-model-len 4096             # Reduce from default 8192
--max-num-batched-tokens 2048    # Limit batch size
--max-num-seqs 4                 # Max 4 concurrent requests
```

### 3. Image Resolution Reduction
```bash
# Process PDFs at 150 DPI instead of 300 DPI (4x less VRAM)
--mm-processor-kwargs '{"max_image_size": 1024}'
```

## Deployment Steps

### 1. Pull Base Container

```bash
ssh neptune@192.168.2.110 << 'ENDSSH'
  # Pull standard PyTorch container
  docker pull pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime
ENDSSH
```

### 2. Create RTX 4090-Optimized Dockerfile

```bash
ssh neptune@192.168.2.110 << 'ENDSSH'
  cat > /home/neptune/Dockerfile.deepseek-ocr-rtx4090 << 'EOF'
FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git curl build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install vLLM with Flash Attention support (for Ada Lovelace)
RUN pip install --no-cache-dir \
    vllm==0.6.4.post1 \
    transformers>=4.45.0 \
    pillow \
    && rm -rf /root/.cache/pip

# Pre-download DeepSeek-OCR model
# Note: If quantized model exists, use that instead
RUN python -c "from transformers import AutoModel; \
    AutoModel.from_pretrained('deepseek-ai/DeepSeek-OCR', trust_remote_code=True)"

# Set Flash Attention v2 (Ada Lovelace compatible)
ENV VLLM_FLASH_ATTN_VERSION=2

# Expose vLLM API
EXPOSE 8000

# Start vLLM with RTX 4090 memory optimizations
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

  # Build container
  docker build -t deepseek-ocr-vllm-rtx4090:latest -f /home/neptune/Dockerfile.deepseek-ocr-rtx4090 .
ENDSSH
```

### 3. Run vLLM Container on Calypso

```bash
ssh neptune@192.168.2.110 << 'ENDSSH'
  # Stop any existing container
  docker stop deepseek-ocr-vllm 2>/dev/null || true
  docker rm deepseek-ocr-vllm 2>/dev/null || true

  # Run vLLM with DeepSeek-OCR (RTX 4090 optimized)
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
```

**Key flags:**
- `--shm-size 8g`: Shared memory for inter-process communication
- `--gpus all`: Expose RTX 4090 to container
- `-v ~/.cache/huggingface`: Persist model cache

### 4. Verify Deployment

```bash
# Check container logs (look for VRAM usage)
ssh neptune@192.168.2.110 'docker logs deepseek-ocr-vllm --tail 100'

# Expected log lines:
# INFO:     GPU memory utilization: 90%
# INFO:     Max model length: 4096 tokens
# INFO:     Allocated 21.6 GB / 24.0 GB GPU memory

# Test health endpoint
ssh neptune@192.168.2.110 'curl -s http://localhost:8000/health'

# Test model listing
ssh neptune@192.168.2.110 'curl -s http://localhost:8000/v1/models | jq'
```

### 5. Add Cloudflare Tunnel Route (Optional)

If you want to expose Calypso's vLLM endpoint publicly:

```bash
# Update tunnel configuration (via Pulumi or manual config)
# Add to infrastructure/calypso/cloudflared-tunnel-config.json
{
  "ingress": [
    {
      "hostname": "deepseek-rtx.goldfish.io",
      "service": "http://192.168.2.110:8000"
    },
    {
      "service": "http_status:404"
    }
  ]
}
```

## API Usage

### OpenAI-Compatible Endpoint

Same API as DGX Spark, but with lower throughput:

```typescript
// From Cloudflare Worker
const response = await fetch('http://192.168.2.110:8000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'deepseek-ai/DeepSeek-OCR',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '<|grounding|>Convert the document to markdown.' },
          { type: 'image_url', image_url: { url: pdfUrl } }
        ]
      }
    ],
    max_tokens: 2048,  // Reduced from 4096 for RTX 4090
    temperature: 0
  })
});
```

### PDF Processing Recommendations

**For RTX 4090 (24GB VRAM):**
1. **Small PDFs (<10 pages)**: Process normally
2. **Medium PDFs (10-30 pages)**: Process in batches of 5-10 pages
3. **Large PDFs (>30 pages)**: Use sequential processing or reduce image resolution

**Image resolution adjustment:**
```python
# Pre-process PDFs to reduce resolution
from PIL import Image
import pdf2image

images = pdf2image.convert_from_path(
    'document.pdf',
    dpi=150  # Reduce from 300 DPI (4x less VRAM)
)
```

## Performance Expectations

**RTX 4090 vs DGX Spark:**

| Task | DGX Spark (128GB) | RTX 4090 (24GB) |
|------|------------------|----------------|
| 10-page PDF | ~10-15 sec | ~25-40 sec |
| 50-page PDF | ~30-60 sec | **2-4 minutes** (or OOM) |
| Throughput | ~2500 tokens/sec | **~800-1200 tokens/sec** |
| Concurrent requests | High (20+) | **Low (2-4)** |
| Max resolution | 300 DPI | **150-200 DPI** |

**Recommendations:**
- Use RTX 4090 for development/testing and small PDFs
- Use DGX Spark (when available) for production workloads
- Implement automatic failover: RTX 4090 → DGX Spark for large PDFs

## Monitoring

### GPU Memory Usage

```bash
# Watch GPU memory in real-time
ssh neptune@192.168.2.110 'watch -n 1 nvidia-smi'

# Check VRAM usage in container logs
ssh neptune@192.168.2.110 'docker logs deepseek-ocr-vllm 2>&1 | grep -i memory'
```

### vLLM Metrics (Prometheus)

Add to Grafana dashboard:

```promql
# GPU utilization
nvidia_smi_utilization_gpu{instance="192.168.2.110"}

# VRAM usage (should stay < 22GB)
nvidia_smi_memory_used_bytes{instance="192.168.2.110"} / 1024^3

# Request rate (should be low, 2-4 concurrent)
rate(vllm_request_total[5m])

# Queue depth (high = VRAM bottleneck)
vllm_queue_size
```

## Troubleshooting

### Issue: Out of Memory (OOM)

**Symptoms:**
```
CUDA out of memory. Tried to allocate 512.00 MiB (GPU 0; 23.99 GiB total capacity)
```

**Solutions:**
1. Reduce `--max-model-len` to 2048 or 1024
2. Reduce `--max-num-seqs` to 2 or 1
3. Use quantization (`--quantization awq`)
4. Reduce image resolution (150 DPI instead of 300 DPI)
5. Process PDFs sequentially (1 page at a time)

### Issue: Slow Performance

**Symptoms:** 50-page PDF takes >10 minutes

**Solutions:**
1. Check GPU utilization: `nvidia-smi` (should be 90-100%)
2. Verify Flash Attention enabled: Check logs for "Using Flash Attention v2"
3. Reduce batch size if VRAM is maxed out
4. Consider using DGX Spark for large PDFs

### Issue: Flash Attention Not Working

**Symptoms:** Log shows "Flash Attention not available, using standard attention"

**Fix:**
```bash
# Reinstall Flash Attention for Ada Lovelace
ssh neptune@192.168.2.110 << 'ENDSSH'
  docker exec -it deepseek-ocr-vllm bash -c \
    "pip install flash-attn --no-build-isolation"
ENDSSH
```

## Quantization (Advanced)

If full model doesn't fit in 24GB, use 4-bit quantization:

### Option A: AWQ Quantization

```dockerfile
# Add to Dockerfile before CMD
RUN pip install --no-cache-dir autoawq

# Download and quantize model (first run only)
RUN python -c "from awq import AutoAWQForCausalLM; \
    model = AutoAWQForCausalLM.from_pretrained('deepseek-ai/DeepSeek-OCR'); \
    model.quantize(w_bit=4, q_config={'zero_point': True, 'q_group_size': 128}); \
    model.save_quantized('deepseek-ocr-awq-4bit')"

# Update CMD to use quantized model
CMD ["vllm", "serve", "./deepseek-ocr-awq-4bit", \
     "--quantization", "awq", \
     # ... rest of flags
```

### Option B: GPTQ Quantization

```bash
# Use pre-quantized model if available
vllm serve TheBloke/DeepSeek-OCR-GPTQ \
  --quantization gptq \
  --gpu-memory-utilization 0.90 \
  # ... rest of flags
```

**VRAM savings:**
- FP16 (full precision): ~18-22 GB
- AWQ 4-bit: ~6-8 GB
- GPTQ 4-bit: ~5-7 GB

## Rollback Plan

If RTX 4090 deployment has issues:

1. **Immediate:** Stop container
   ```bash
   ssh neptune@192.168.2.110 'docker stop deepseek-ocr-vllm'
   ```

2. **Fallback:** Use DGX Spark (if available) or HF Space

3. **Debug:** Check logs
   ```bash
   ssh neptune@192.168.2.110 'docker logs deepseek-ocr-vllm --tail 200'
   ```

## Next Steps

1. **Quantization experiment**: Test AWQ vs GPTQ vs FP16 performance
2. **Benchmarking**: Compare RTX 4090 vs DGX Spark on real PDFs
3. **Auto-scaling**: Route large PDFs to DGX Spark, small PDFs to RTX 4090
4. **Monitoring**: Add Grafana dashboard for RTX 4090 metrics

## References

- [vLLM DeepSeek-OCR Recipe](https://docs.vllm.ai/projects/recipes/en/latest/DeepSeek/DeepSeek-OCR.html)
- [vLLM Quantization Guide](https://docs.vllm.ai/en/latest/quantization/auto_awq.html)
- [NVIDIA RTX 4090 Specs](https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/)
- [Flash Attention v2 for Ada Lovelace](https://github.com/Dao-AILab/flash-attention)
