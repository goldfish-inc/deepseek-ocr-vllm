# DeepSeek-OCR vLLM Deployment on DGX Spark

Deploy DeepSeek-OCR with vLLM on DGX Spark (Blackwell GPU) for native PDF processing.

## Architecture

```
PDF Upload → Cloudflare Worker → DGX Spark (192.168.2.119)
                                      ↓
                            vLLM + DeepSeek-OCR (native PDF)
                                      ↓
                         OCR Results → Parquet → R2 → MotherDuck
```

## Hardware Specs

**DGX Spark:**
- IP: `192.168.2.119` (spark-291b)
- User: `sparky`
- GPU: NVIDIA Grace Blackwell (6,144 CUDA cores)
- Memory: 128 GB unified LPDDR5x
- SSH: Port 22, key: `/Users/rt/.ssh/spark_key`

## Container Selection

**Use NVIDIA NGC PyTorch Container for Blackwell:**
```bash
# Official NVIDIA container with CUDA 12.8 + PyTorch 2.6 for Blackwell
nvcr.io/nvidia/pytorch:25.02-py3
```

**Why this container:**
- ✅ Official NVIDIA image for Blackwell GPUs
- ✅ CUDA 12.8 + PyTorch 2.6 (required for vLLM on Blackwell)
- ✅ Pre-installed NGC libraries
- ✅ Supports unified memory architecture

## Deployment Steps

### 1. Pull NVIDIA Container

```bash
ssh sparky@192.168.2.119 << 'ENDSSH'
  # Pull official NVIDIA PyTorch container
  docker pull nvcr.io/nvidia/pytorch:25.02-py3
ENDSSH
```

### 2. Install vLLM Inside Container

```bash
ssh sparky@192.168.2.119 << 'ENDSSH'
  # Create Dockerfile to add vLLM to NGC base
  cat > /home/sparky/Dockerfile.deepseek-ocr << 'EOF'
FROM nvcr.io/nvidia/pytorch:25.02-py3

# Install vLLM nightly (required for DeepSeek-OCR support)
RUN pip install -U vllm --pre \
    --extra-index-url https://wheels.vllm.ai/nightly \
    --extra-index-url https://download.pytorch.org/whl/cu129 \
    --index-strategy unsafe-best-match

# Pre-download DeepSeek-OCR model
RUN python -c "from transformers import AutoModel; AutoModel.from_pretrained('deepseek-ai/DeepSeek-OCR', trust_remote_code=True)"

# Set environment for Flash Attention v2 (Blackwell compatibility)
ENV VLLM_FLASH_ATTN_VERSION=2

# Expose vLLM OpenAI-compatible API
EXPOSE 8000

# Start vLLM server with DeepSeek-OCR
CMD ["vllm", "serve", "deepseek-ai/DeepSeek-OCR", \
     "--logits_processors", "vllm.model_executor.models.deepseek_ocr:NGramPerReqLogitsProcessor", \
     "--no-enable-prefix-caching", \
     "--mm-processor-cache-gb", "0", \
     "--host", "0.0.0.0", \
     "--port", "8000"]
EOF

  # Build container
  docker buildx build --platform linux/amd64 -t deepseek-ocr-vllm:latest -f /home/sparky/Dockerfile.deepseek-ocr --load .
ENDSSH
```

### 3. Run vLLM Container

```bash
ssh sparky@192.168.2.119 << 'ENDSSH'
  # Stop any existing container
  docker stop deepseek-ocr-vllm 2>/dev/null || true
  docker rm deepseek-ocr-vllm 2>/dev/null || true

  # Run vLLM with DeepSeek-OCR
  docker run -d \
    --name deepseek-ocr-vllm \
    --gpus all \
    --restart unless-stopped \
    -p 8000:8000 \
    -v /home/sparky/.cache/huggingface:/root/.cache/huggingface \
    -e VLLM_FLASH_ATTN_VERSION=2 \
    deepseek-ocr-vllm:latest
ENDSSH
```

### 4. Verify Deployment

```bash
# Check container logs
ssh sparky@192.168.2.119 'docker logs deepseek-ocr-vllm --tail 50'

# Test health endpoint
ssh sparky@192.168.2.119 'curl -s http://localhost:8000/health'

# Test model listing
ssh sparky@192.168.2.119 'curl -s http://localhost:8000/v1/models | jq'
```

### 5. Add Cloudflare Tunnel Route

Update tunnel configuration to expose vLLM endpoint:

```bash
# Add to infrastructure/spark/cloudflared-tunnel-config.json
{
  "ingress": [
    {
      "hostname": "ollama.goldfish.io",
      "service": "http://localhost:11434"
    },
    {
      "hostname": "deepseek.goldfish.io",
      "service": "http://localhost:8000"
    },
    {
      "service": "http_status:404"
    }
  ]
}
```

Apply via Cloudflare API or update in `cloud/src/index.ts`.

## API Usage

### OpenAI-Compatible Endpoint

vLLM exposes OpenAI-compatible API at `http://localhost:8000/v1/chat/completions`:

```typescript
// From Cloudflare Worker
const response = await fetch('https://deepseek.goldfish.io/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'CF-Access-Client-Id': SPARK_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': SPARK_ACCESS_CLIENT_SECRET,
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
    max_tokens: 4096,
    temperature: 0
  })
});
```

### Native PDF Processing

vLLM handles PDF → image conversion internally:
- Pass PDF URL directly in `image_url`
- vLLM extracts all pages automatically
- Parallel page processing on Blackwell GPU
- Returns combined OCR output

## Performance Expectations

**50-page PDF:**
- Transformers (HF Space): ~5-10 minutes (sequential)
- vLLM (DGX Spark): ~30-60 seconds (parallel)

**Throughput:**
- ~2500 tokens/second
- 128 GB unified memory = no VRAM constraints
- Concurrent requests supported

## Monitoring

Add to Grafana dashboard:

```promql
# Container health
up{job="deepseek-ocr-vllm"}

# Request rate
rate(vllm_request_total[5m])

# Latency p99
histogram_quantile(0.99, rate(vllm_request_duration_seconds_bucket[5m]))

# GPU utilization (via nvidia-smi)
nvidia_smi_utilization_gpu{instance="192.168.2.119"}
```

## Cloudflare Worker Integration

Update `workers/vessel-ner/src/lib/deepseek-ocr.ts`:

```typescript
export class DeepSeekOcrClient {
  private useVllm: boolean = true; // Feature flag
  private vllmEndpoint = 'https://deepseek.goldfish.io';

  async processPdfFromUrl(pdfUrl: string, filename: string): Promise<DeepSeekOcrResponse[]> {
    if (this.useVllm) {
      return this.processWithVllm(pdfUrl, filename);
    } else {
      // Fallback to HF Space (transformers + pdf2image)
      return this.processWithGradio(pdfUrl, filename);
    }
  }

  private async processWithVllm(pdfUrl: string, filename: string): Promise<DeepSeekOcrResponse[]> {
    const response = await fetch(`${this.vllmEndpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': this.sparkAccessClientId,
        'CF-Access-Client-Secret': this.sparkAccessClientSecret,
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
        max_tokens: 4096,
        temperature: 0
      })
    });

    const result = await response.json();
    const ocrText = result.choices[0].message.content;

    return [{
      text: ocrText,
      clean_text: this.cleanOcrText(ocrText),
      has_tables: ocrText.includes('|'),
      metadata: { confidence: 1.0 }
    }];
  }
}
```

## Rollback Plan

If vLLM has issues:

1. **Immediate:** Set `useVllm = false` in Worker (uses HF Space fallback)
2. **Container:** `ssh sparky@192.168.2.119 'docker stop deepseek-ocr-vllm'`
3. **Tunnel:** Remove `deepseek.goldfish.io` route

## Secrets

Add to Pulumi ESC:

```bash
# DGX Spark vLLM endpoint
pulumi config set --cwd cloud dgx-spark:deepseekOcrEndpoint "https://deepseek.goldfish.io"

# Reuse existing Cloudflare Access credentials
# dgx-spark:accessClientId
# dgx-spark:accessClientSecret
```

## Troubleshooting: ARM64 + CUDA Build Challenges

### Problem: vLLM Build on ARM64 Grace Blackwell

**Context:** vLLM 0.11.0 doesn't provide pre-built wheels for ARM64 + CUDA (aarch64), requiring source builds that must preserve NVIDIA's custom PyTorch.

**Failed Approaches:**

1. **pip install vllm (wheel)**: No ARM64+CUDA wheels available on PyPI or vLLM nightly
2. **PIP_CONSTRAINT approach**: pip installed CPU-only torch 2.8.0 from PyPI, replacing NVIDIA's CUDA version
   - **Error**: `ImportError: libtorch_cuda.so: cannot open shared object file`
   - **Root cause**: Constraint file only prevented version changes, not source switching

**Working Solution: Explicit Dependency Management**

```dockerfile
FROM nvcr.io/nvidia/pytorch:25.05-py3

# Install ALL vLLM dependencies WITHOUT torch
RUN pip install --no-cache-dir \
    'transformers>=4.45.0' \
    'tokenizers>=0.20.0' \
    sentencepiece \
    'tiktoken>=0.6.0' \
    lm-format-enforcer \
    'outlines>=0.1.0,<0.2.0' \
    fastapi \
    'pydantic>=2.0' \
    'uvicorn[standard]' \
    aiohttp \
    openai \
    requests \
    tqdm \
    'ray>=2.9' \
    msgspec \
    prometheus-client \
    prometheus-fastapi-instrumentator \
    py-cpuinfo \
    psutil \
    numpy \
    pillow \
    typing-extensions \
    filelock \
    pyzmq \
    blake3 \
    cbor2 \
    compressed-tensors \
    interegular \
    xgrammar

# Verify torch WASN'T upgraded
RUN python3 -c "import torch; v=torch.__version__; print(f'PyTorch: {v}'); assert '2.8.0a0' in v"

# Build vLLM from source with --no-deps (all dependencies already installed)
RUN git clone https://github.com/vllm-project/vllm.git --branch v0.11.0 --single-branch /opt/vllm && \
    cd /opt/vllm && \
    pip install --no-cache-dir --no-build-isolation --no-deps -e .
```

**Key Insights:**

1. **Never use `--no-deps` alone**: Must manually install ALL dependencies first, excluding torch
2. **Dependency discovery**: When using `--no-deps`, missing dependencies only appear at runtime (cbor2, prometheus-fastapi-instrumentator, blake3, etc.)
3. **PyTorch ABI compatibility**: NVIDIA PyTorch 2.8.0a0+5228986c39.nv25.05 is NOT compatible with PyPI's torch 2.8.0
4. **Build time**: ~70-80 minutes for source builds (compiling C++/CUDA extensions for sm_90)

### Common Build Errors

**Error: `ModuleNotFoundError: No module named 'cbor2'`**
- **Cause**: Using `--no-deps` without installing all vLLM dependencies
- **Fix**: Add missing package to pip install step before vLLM build

**Error: `ImportError: libtorch_cuda.so: cannot open shared object file`**
- **Cause**: pip installed CPU-only torch, replacing NVIDIA's CUDA version
- **Fix**: Explicitly exclude torch from ALL pip operations during vLLM build

**Error: `torch 2.8.0+cpu` shown in verification**
- **Cause**: pip upgraded PyTorch despite constraint files
- **Fix**: Install dependencies without allowing torch installation at all

### Build Verification Checklist

After build completes, verify:

```bash
# 1. PyTorch version preserved (must be NVIDIA CUDA version)
docker run --rm IMAGE python3 -c "import torch; print(torch.__version__)"
# Expected: 2.8.0a0+5228986c39.nv25.05 (or similar NVIDIA version)
# WRONG: 2.8.0+cpu

# 2. PyTorch location (must be NVIDIA installation)
docker run --rm IMAGE python3 -c "import torch; print(torch.__file__)"
# Expected: /opt/pytorch/...
# WRONG: /usr/local/lib/python3.12/dist-packages/torch/

# 3. CUDA libraries present
docker run --rm --gpus all IMAGE python3 -c "import torch; print(torch.cuda.is_available())"
# Expected: True

# 4. vLLM imports without errors
docker run --rm --gpus all IMAGE python3 -c "import vllm; print(vllm.__version__)"
# Expected: 0.11.0

# 5. GPU detected (requires --gpus flag)
docker run --rm --gpus all IMAGE python3 -m vllm.entrypoints.openai.api_server --help
# Should NOT error with missing libtorch_cuda.so
```

## References

- [vLLM DeepSeek-OCR Recipe](https://docs.vllm.ai/projects/recipes/en/latest/DeepSeek/DeepSeek-OCR.html)
- [NVIDIA NGC PyTorch Container](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/pytorch)
- [vLLM Blackwell Support Issue #14452](https://github.com/vllm-project/vllm/issues/14452)
- [vLLM Installation - Building from Source](https://docs.vllm.ai/en/latest/getting_started/installation.html#build-from-source)
