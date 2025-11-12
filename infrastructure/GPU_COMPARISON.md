# GPU Comparison: RTX 4090 vs DGX Spark for DeepSeek-OCR vLLM

This document compares the two GPU deployment options for DeepSeek-OCR vLLM.

## Hardware Comparison

| Spec | RTX 4090 (Calypso) | DGX Spark (Blackwell) |
|------|-------------------|----------------------|
| **Architecture** | Ada Lovelace | Grace Blackwell |
| **CUDA Cores** | 16,384 | 6,144 (unified CPU/GPU) |
| **VRAM** | **24 GB GDDR6X** | **128 GB unified LPDDR5x** |
| **Memory Bandwidth** | 1,008 GB/s | 900 GB/s (unified) |
| **TDP** | 450W | 500W |
| **CUDA Compute** | 8.9 | 10.0 |
| **Host** | Calypso (192.168.2.110) | DGX Spark (192.168.2.119) |
| **Access** | `neptune@192.168.2.110` | `sparky@192.168.2.119` |
| **K3s Integration** | ✅ Already integrated | ⏳ Planned |

## Software Configuration Comparison

| Configuration | RTX 4090 | DGX Spark |
|--------------|---------|-----------|
| **Base Container** | `pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime` | `nvcr.io/nvidia/pytorch:25.02-py3` |
| **CUDA Version** | 12.1 | 12.8 |
| **PyTorch Version** | 2.3.0 | 2.6 (NVIDIA custom) |
| **vLLM Version** | 0.6.4.post1 | 0.11.0 (nightly) |
| **Flash Attention** | v2 (Ada) | v2 (Blackwell optimized) |

## vLLM Configuration Differences

### RTX 4090 (24GB VRAM - Memory Constrained)

```bash
vllm serve deepseek-ai/DeepSeek-OCR \
  --gpu-memory-utilization 0.90        # Use 90% of 24GB = 21.6GB
  --max-model-len 4096                 # Reduced from default 8192
  --max-num-batched-tokens 2048        # Limit batch size
  --max-num-seqs 4                     # Max 4 concurrent requests
  --logits_processors vllm.model_executor.models.deepseek_ocr:NGramPerReqLogitsProcessor \
  --no-enable-prefix-caching \
  --mm-processor-cache-gb 0
```

### DGX Spark (128GB - No Memory Constraints)

```bash
vllm serve deepseek-ai/DeepSeek-OCR \
  --gpu-memory-utilization 0.95        # Can use more memory
  --max-model-len 8192                 # Full context length
  --max-num-batched-tokens 8192        # Larger batches
  --max-num-seqs 16                    # More concurrent requests
  --logits_processors vllm.model_executor.models.deepseek_ocr:NGramPerReqLogitsProcessor \
  --no-enable-prefix-caching \
  --mm-processor-cache-gb 0
```

## Performance Comparison

### Throughput

| Task | RTX 4090 (24GB) | DGX Spark (128GB) | Speedup |
|------|----------------|-------------------|---------|
| **Tokens/sec** | ~800-1200 | ~2500 | **2.1-3.1x** |
| **10-page PDF** | ~25-40 sec | ~10-15 sec | **2.5x faster** |
| **50-page PDF** | ~2-4 min (or OOM) | ~30-60 sec | **4-8x faster** |
| **Concurrent requests** | 2-4 | 16-20 | **4-8x more** |
| **Max resolution** | 150-200 DPI | 300 DPI | **2x higher** |

### Memory Usage

| Component | RTX 4090 (24GB) | DGX Spark (128GB) |
|-----------|----------------|-------------------|
| **Model (FP16)** | ~18-22 GB | ~18-22 GB |
| **Model (4-bit AWQ)** | ~6-8 GB | N/A (not needed) |
| **KV Cache** | Limited (~2GB) | Large (~10-20GB) |
| **Image buffers** | Small (1-2 images) | Large (10+ images) |
| **Available for inference** | **~2-6 GB** | **~106 GB** |

## Use Case Recommendations

### Use RTX 4090 (Calypso) For:

✅ **Development & Testing**
- Quick iteration on prompts and configurations
- Testing small PDFs (<10 pages)
- Local development without remote access

✅ **Small-Scale Production**
- Processing individual documents (<10 pages)
- Low-volume workloads (<100 PDFs/day)
- Sequential processing acceptable

✅ **Cost-Sensitive Workloads**
- Calypso already exists in cluster
- No additional hardware cost

### Use DGX Spark For:

✅ **Production Workloads**
- High-volume PDF processing (>1000 PDFs/day)
- Large documents (>30 pages)
- Real-time processing requirements

✅ **Concurrent Users**
- Multiple users accessing API simultaneously
- Batch processing pipelines
- High availability requirements

✅ **Maximum Quality**
- Highest resolution (300 DPI)
- Full context length (8192 tokens)
- Best accuracy on complex documents

## Deployment Decision Tree

```
Start
  │
  ├─ Is this for development/testing?
  │   └─ YES → Use RTX 4090 (Calypso)
  │
  ├─ Are PDFs small (<10 pages)?
  │   └─ YES → Use RTX 4090 (Calypso)
  │
  ├─ Is volume low (<100 PDFs/day)?
  │   └─ YES → Use RTX 4090 (Calypso)
  │
  ├─ Do you need high concurrency (>5 requests)?
  │   └─ YES → Use DGX Spark
  │
  ├─ Are PDFs large (>30 pages)?
  │   └─ YES → Use DGX Spark
  │
  └─ Is this production with SLA requirements?
      └─ YES → Use DGX Spark
```

## Cost Comparison

| Factor | RTX 4090 | DGX Spark |
|--------|---------|-----------|
| **Hardware cost** | $0 (already owned) | $5,000-15,000 |
| **Power (24/7)** | ~450W = $40/month | ~500W = $45/month |
| **Maintenance** | Low (consumer GPU) | Low (enterprise) |
| **Replacement parts** | Available | Enterprise support |
| **Total 1-year TCO** | **$480** | **$5,500-15,500** |

## Hybrid Deployment Strategy (Recommended)

**Best of both worlds:**

1. **Default to RTX 4090** for most requests
2. **Auto-failover to DGX Spark** for:
   - Large PDFs (>20 pages)
   - High-priority requests
   - When RTX 4090 is overloaded

### Implementation in Cloudflare Worker

```typescript
export class DeepSeekOcrClient {
  private rtx4090Endpoint = 'http://192.168.2.110:8000';
  private dgxSparkEndpoint = 'https://deepseek.goldfish.io';

  async processPdf(pdfUrl: string, pageCount: number): Promise<OcrResult> {
    // Route based on PDF size
    if (pageCount > 20) {
      console.log('Large PDF detected, routing to DGX Spark');
      return this.processWithVllm(this.dgxSparkEndpoint, pdfUrl);
    }

    try {
      console.log('Processing on RTX 4090');
      return await this.processWithVllm(this.rtx4090Endpoint, pdfUrl);
    } catch (error) {
      if (error.message.includes('out of memory')) {
        console.warn('RTX 4090 OOM, failing over to DGX Spark');
        return this.processWithVllm(this.dgxSparkEndpoint, pdfUrl);
      }
      throw error;
    }
  }
}
```

## Migration Path

### Phase 1: Current (RTX 4090 only)
- Deploy to Calypso
- Test with real workloads
- Measure performance and limitations

### Phase 2: Add DGX Spark
- Deploy to DGX Spark when available
- Configure hybrid routing
- Monitor both endpoints

### Phase 3: Optimize
- Fine-tune routing logic based on metrics
- Add autoscaling if needed
- Consider load balancing

## Monitoring Differences

### RTX 4090 Metrics to Watch

```promql
# GPU memory (should stay < 22GB)
nvidia_smi_memory_used_bytes{instance="192.168.2.110"} / 1024^3 < 22

# OOM incidents (should be 0)
rate(vllm_request_failed_total{reason="out_of_memory"}[5m])

# Queue depth (high = need DGX Spark)
vllm_queue_size{instance="192.168.2.110"} > 5
```

### DGX Spark Metrics to Watch

```promql
# GPU utilization (should be high)
nvidia_smi_utilization_gpu{instance="192.168.2.119"} > 80

# Request throughput
rate(vllm_request_success_total{instance="192.168.2.119"}[5m])

# Latency p99 (should be low)
histogram_quantile(0.99, rate(vllm_request_duration_seconds_bucket[5m])) < 60
```

## Troubleshooting by Platform

### RTX 4090 Common Issues

**Issue:** Out of Memory (OOM)
```bash
# Solutions:
1. Reduce max-model-len to 2048
2. Enable quantization (--quantization awq)
3. Reduce image resolution (150 DPI)
4. Failover to DGX Spark
```

**Issue:** Slow inference
```bash
# Check Flash Attention is enabled
docker logs deepseek-ocr-vllm 2>&1 | grep -i "flash attention"

# Should see: "Using Flash Attention v2"
```

### DGX Spark Common Issues

**Issue:** PyTorch version conflicts
```bash
# Verify NVIDIA PyTorch is used (not PyPI)
docker exec -it deepseek-ocr-vllm python -c "import torch; print(torch.__version__)"

# Should see: 2.8.0a0+...nv25.05 (NVIDIA version)
# NOT: 2.8.0+cpu (PyPI version)
```

**Issue:** vLLM build failures
```bash
# Use explicit dependency management (see infrastructure/spark/deepseek-ocr-vllm.md)
# Install all deps without torch, then build vLLM with --no-deps
```

## Summary

| Aspect | RTX 4090 Winner? | DGX Spark Winner? |
|--------|-----------------|-------------------|
| **Development** | ✅ | |
| **Small PDFs** | ✅ | |
| **Large PDFs** | | ✅ |
| **Concurrency** | | ✅ |
| **Cost** | ✅ | |
| **Performance** | | ✅ |
| **Availability** | ✅ (already deployed) | ⏳ (planned) |

**Recommendation:** Start with **RTX 4090 (Calypso)** for immediate deployment. Add **DGX Spark** when available for production workloads and large PDFs.
