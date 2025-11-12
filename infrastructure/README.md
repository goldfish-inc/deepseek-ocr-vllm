# Infrastructure Deployment Guides

This directory contains deployment configurations for GPU-accelerated DeepSeek-OCR vLLM across different hardware platforms.

## Quick Navigation

### 🚀 Quick Start

**Want to get started immediately?**
- **RTX 4090 (Calypso)**: [`calypso/QUICKSTART.md`](./calypso/QUICKSTART.md) - 10-minute deployment
- **DGX Spark**: [`spark/deepseek-ocr-vllm.md`](./spark/deepseek-ocr-vllm.md) - Production deployment

### 📊 Comparison

**Not sure which GPU to use?**
- **GPU Comparison**: [`GPU_COMPARISON.md`](./GPU_COMPARISON.md) - RTX 4090 vs DGX Spark

## Directory Structure

```
infrastructure/
├── README.md                          # This file
├── GPU_COMPARISON.md                  # RTX 4090 vs DGX Spark comparison
│
├── calypso/                           # RTX 4090 (24GB VRAM)
│   ├── QUICKSTART.md                  # 10-minute deployment guide
│   ├── deepseek-ocr-vllm-rtx4090.md   # Full deployment documentation
│   ├── Dockerfile.deepseek-ocr-rtx4090 # Optimized Dockerfile for RTX 4090
│   ├── deploy.sh                      # Automated deployment script
│   └── test-vllm.sh                   # Validation and testing script
│
└── spark/                             # DGX Spark (128GB VRAM)
    └── deepseek-ocr-vllm.md           # Full deployment documentation
```

## Hardware Overview

| Node | GPU | VRAM | Status | Documentation |
|------|-----|------|--------|---------------|
| **Calypso** | RTX 4090 | 24 GB | ✅ Ready | [`calypso/`](./calypso/) |
| **DGX Spark** | Blackwell | 128 GB | ⏳ Planned | [`spark/`](./spark/) |

## Deployment Options

### Option 1: RTX 4090 (Calypso) - Recommended for Getting Started

**Best for:**
- ✅ Development and testing
- ✅ Small PDFs (<10 pages)
- ✅ Low-volume workloads
- ✅ Immediate deployment (already available)

**Quick deployment:**
```bash
./infrastructure/calypso/deploy.sh
```

**Documentation:**
- [QUICKSTART.md](./calypso/QUICKSTART.md) - 10-minute guide
- [deepseek-ocr-vllm-rtx4090.md](./calypso/deepseek-ocr-vllm-rtx4090.md) - Full guide

### Option 2: DGX Spark - Recommended for Production

**Best for:**
- ✅ Production workloads
- ✅ Large PDFs (>30 pages)
- ✅ High concurrency (>10 requests)
- ✅ Maximum performance

**Documentation:**
- [deepseek-ocr-vllm.md](./spark/deepseek-ocr-vllm.md) - Full deployment guide

### Option 3: Hybrid (Both) - Recommended for Best ROI

**Strategy:**
1. Deploy RTX 4090 for most requests
2. Deploy DGX Spark for large PDFs and high-priority workloads
3. Auto-route based on PDF size and system load

**Documentation:**
- [GPU_COMPARISON.md](./GPU_COMPARISON.md) - See "Hybrid Deployment Strategy"

## Key Differences

| Aspect | RTX 4090 (Calypso) | DGX Spark |
|--------|-------------------|-----------|
| **VRAM** | 24 GB | 128 GB |
| **Throughput** | ~800-1200 tokens/sec | ~2500 tokens/sec |
| **50-page PDF** | 2-4 minutes | 30-60 seconds |
| **Concurrency** | 2-4 requests | 16-20 requests |
| **Resolution** | 150-200 DPI | 300 DPI |
| **Cost** | $0 (already owned) | $5,000-15,000 |
| **Availability** | ✅ Now | ⏳ Planned |

## Deployment Scripts

### RTX 4090 (Calypso)

| Script | Purpose | Usage |
|--------|---------|-------|
| `calypso/deploy.sh` | One-command deployment | `./infrastructure/calypso/deploy.sh` |
| `calypso/test-vllm.sh` | Validate deployment | `./infrastructure/calypso/test-vllm.sh` |

### Manual Commands

**Start:**
```bash
ssh neptune@192.168.2.110 'docker start deepseek-ocr-vllm'
```

**Stop:**
```bash
ssh neptune@192.168.2.110 'docker stop deepseek-ocr-vllm'
```

**Logs:**
```bash
ssh neptune@192.168.2.110 'docker logs -f deepseek-ocr-vllm'
```

**GPU Monitor:**
```bash
ssh neptune@192.168.2.110 'watch -n 1 nvidia-smi'
```

## API Endpoints

| Platform | Endpoint | Access |
|----------|----------|--------|
| **RTX 4090** | `http://192.168.2.110:8000` | LAN only |
| **DGX Spark** | `https://deepseek.goldfish.io` | Cloudflare Tunnel |

## Common Issues

### RTX 4090: Out of Memory

**Symptoms:** Container crashes, "CUDA out of memory" errors

**Solutions:**
1. Reduce `max-model-len` to 2048 in Dockerfile
2. Enable quantization (AWQ 4-bit)
3. Reduce image resolution to 150 DPI
4. Process PDFs sequentially

See [calypso/deepseek-ocr-vllm-rtx4090.md](./calypso/deepseek-ocr-vllm-rtx4090.md#troubleshooting) for details.

### DGX Spark: Build Failures

**Symptoms:** vLLM fails to build, PyTorch version conflicts

**Solutions:**
1. Use explicit dependency management
2. Install dependencies without torch first
3. Build vLLM with `--no-deps`

See [spark/deepseek-ocr-vllm.md](./spark/deepseek-ocr-vllm.md#troubleshooting-arm64--cuda-build-challenges) for details.

## Performance Benchmarks

| Task | RTX 4090 | DGX Spark | Winner |
|------|---------|-----------|--------|
| 10-page PDF | 25-40 sec | 10-15 sec | DGX Spark (2.5x) |
| 50-page PDF | 2-4 min | 30-60 sec | DGX Spark (4-8x) |
| Tokens/sec | 800-1200 | 2500 | DGX Spark (2-3x) |
| Concurrent requests | 2-4 | 16-20 | DGX Spark (4-8x) |

Full comparison: [GPU_COMPARISON.md](./GPU_COMPARISON.md)

## Monitoring

### Grafana Metrics

**RTX 4090:**
```promql
# GPU memory usage (should stay < 22GB)
nvidia_smi_memory_used_bytes{instance="192.168.2.110"} / 1024^3

# Request rate
rate(vllm_request_total{instance="192.168.2.110"}[5m])
```

**DGX Spark:**
```promql
# GPU utilization (should be 80-100%)
nvidia_smi_utilization_gpu{instance="192.168.2.119"}

# Latency p99
histogram_quantile(0.99, rate(vllm_request_duration_seconds_bucket[5m]))
```

## Next Steps

1. **Deploy RTX 4090**: Follow [calypso/QUICKSTART.md](./calypso/QUICKSTART.md)
2. **Test with real PDFs**: Use test script or API
3. **Monitor performance**: Add to Grafana dashboards
4. **Plan DGX Spark**: When needed for production workloads
5. **Implement hybrid routing**: See [GPU_COMPARISON.md](./GPU_COMPARISON.md)

## Support

- **RTX 4090 issues**: See [calypso/deepseek-ocr-vllm-rtx4090.md](./calypso/deepseek-ocr-vllm-rtx4090.md#troubleshooting)
- **DGX Spark issues**: See [spark/deepseek-ocr-vllm.md](./spark/deepseek-ocr-vllm.md#troubleshooting-arm64--cuda-build-challenges)
- **General questions**: Check [GPU_COMPARISON.md](./GPU_COMPARISON.md)

## Contributing

When adding new GPU platforms:
1. Create new directory: `infrastructure/<node-name>/`
2. Add Dockerfile with optimizations for that GPU
3. Create deployment script: `deploy.sh`
4. Create testing script: `test-vllm.sh`
5. Document in comparison guide
6. Update this README

## References

- [vLLM DeepSeek-OCR Recipe](https://docs.vllm.ai/projects/recipes/en/latest/DeepSeek/DeepSeek-OCR.html)
- [vLLM Documentation](https://docs.vllm.ai/)
- [DeepSeek-OCR Model](https://huggingface.co/deepseek-ai/DeepSeek-OCR)
- [NVIDIA RTX 4090 Specs](https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/)
- [NVIDIA DGX Spark Specs](https://www.nvidia.com/en-us/data-center/dgx-spark/)
