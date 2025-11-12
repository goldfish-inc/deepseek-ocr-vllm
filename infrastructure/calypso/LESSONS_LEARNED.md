# Lessons Learned: DeepSeek-OCR vLLM on RTX 4090

**Date**: 2025-11-12
**Status**: ✅ WORKING DEPLOYMENT

This document captures critical lessons learned while deploying DeepSeek-OCR with vLLM on RTX 4090 (24GB VRAM).

## TL;DR

**The CLI approach (`vllm serve`) DOES NOT WORK with DeepSeek-OCR.**

You must use the **Python API** with manual model registration and vLLM V0 engine.

---

## What Doesn't Work ❌

### 1. vLLM CLI Server (`vllm serve`)

**We tried:**
```bash
vllm serve deepseek-ai/DeepSeek-OCR \
  --trust-remote-code \
  --gpu-memory-utilization 0.90 \
  --max-model-len 4096
```

**Why it fails:**
- `DeepseekOCRForCausalLM` is not in vLLM's official model registry
- CLI doesn't support runtime model registration
- vLLM V1 engine (default) rejects unsupported architectures

**Error:**
```
ValidationError: Model architectures ['DeepseekOCRForCausalLM'] are not supported for now.
Supported architectures: dict_keys(['LlamaForCausalLM', 'MistralForCausalLM', ...])
```

### 2. vLLM Versions

We tried multiple versions with CLI approach:
- ❌ **vLLM 0.6.4.post1**: Missing CLI arguments
- ❌ **vLLM 0.8.5 (CLI)**: Model not in registry
- ❌ **vLLM 0.11.0 (nightly)**: Same registry issue
- ❌ **vLLM 0.11.0 with V1 engine**: Strict validation rejects custom models

### 3. Transformers Version Conflicts

**Error:**
```python
ImportError: cannot import name 'LlamaFlashAttention2' from 'transformers.models.llama.modeling_llama'
```

**Lesson**: DeepSeek-OCR model code has specific transformers version dependencies (4.46.3)

---

## What Works ✅

### The Python API Approach

**Key Discovery**: DeepSeek-OCR team provides [official repository](https://github.com/deepseek-ai/DeepSeek-OCR) with working Python scripts that:

1. Use vLLM **Python API** (not CLI)
2. Manually register the model
3. Force vLLM **V0 engine** (not V1)

### Correct Implementation

```python
import os
os.environ['VLLM_USE_V1'] = '0'  # Force V0 engine

from vllm import LLM
from vllm.model_executor.models.registry import ModelRegistry
from deepseek_ocr import DeepseekOCRForCausalLM

# Manually register the custom model
ModelRegistry.register_model("DeepseekOCRForCausalLM", DeepseekOCRForCausalLM)

# Initialize vLLM
llm = LLM(
    model='deepseek-ai/DeepSeek-OCR',
    hf_overrides={'architectures': ['DeepseekOCRForCausalLM']},
    trust_remote_code=True,
    max_model_len=4096,
    gpu_memory_utilization=0.9,
    max_num_seqs=2,
    enforce_eager=False,
    disable_mm_preprocessor_cache=True
)
```

### Required Dependencies

**Exact versions that work:**
```
torch==2.6.0
torchvision==0.21.0
torchaudio==2.6.0
transformers==4.46.3
tokenizers==0.20.3
vllm==0.8.5
flash-attn==2.7.3
PyMuPDF
img2pdf
einops
easydict
addict
Pillow
numpy
```

**Base image**: `pytorch/pytorch:2.3.0-cuda12.1-cudnn8-devel` (need `-devel` for flash-attn compilation)

---

## Why vLLM V0 vs V1?

### vLLM V0 (Legacy Engine)
- ✅ More flexible with custom models
- ✅ Supports runtime model registration
- ✅ Allows experimental architectures
- ⚠️ Slightly slower than V1

### vLLM V1 (New Engine, Default in 0.8.5+)
- ❌ Strict model validation
- ❌ Only supports officially registered architectures
- ❌ Rejects `DeepseekOCRForCausalLM` immediately
- ✅ Better performance for supported models

**To use V0:**
```python
os.environ['VLLM_USE_V1'] = '0'  # Must be set BEFORE importing vLLM
```

---

## Performance on RTX 4090

**Successful test results:**
```
Model loaded: deepseek-ai/DeepSeek-OCR
vLLM version: 0.8.5 (V0 engine)
Model weights: 6.23 GiB
KV Cache: 12.99 GiB
Total GPU usage: 19.82 GiB / 22.03 GiB (90%)
Max concurrency: 55.41x (55 concurrent 4K-token requests)
Flash Attention: Enabled
CUDA graphs: Captured
```

**Expected throughput:**
- **10-page PDF**: ~25-40 seconds
- **Tokens/sec**: ~800-1200
- **Max resolution**: 150-200 DPI (due to 24GB VRAM constraint)

---

## Dockerfile Structure

**Working Dockerfile:**

```dockerfile
FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-devel  # Need -devel for flash-attn

# Install system dependencies
RUN apt-get update && apt-get install -y git curl build-essential

# Upgrade to PyTorch 2.6.0
RUN pip install --no-cache-dir \
    torch==2.6.0 \
    torchvision==0.21.0 \
    torchaudio==2.6.0 \
    transformers==4.46.3 \
    tokenizers==0.20.3

# Install vLLM 0.8.5
RUN pip install --no-cache-dir vllm==0.8.5

# Install flash-attn and other dependencies
RUN pip install --no-cache-dir \
    flash-attn==2.7.3 --no-build-isolation \
    PyMuPDF img2pdf einops easydict addict Pillow numpy

# Clone DeepSeek-OCR repository with working scripts
WORKDIR /workspace
RUN git clone https://github.com/deepseek-ai/DeepSeek-OCR.git

WORKDIR /workspace/DeepSeek-OCR/DeepSeek-OCR-master/DeepSeek-OCR-vllm

# Set environment for RTX 4090
ENV VLLM_USE_V1=0
ENV CUDA_VISIBLE_DEVICES=0
ENV VLLM_FLASH_ATTN_VERSION=2

EXPOSE 8000
CMD ["/bin/bash"]
```

---

## Usage

### Build the image:
```bash
cd /home/neptune/Developer/deepseek-ocr-vllm/infrastructure/calypso
docker build -t deepseek-ocr-rtx4090:latest -f Dockerfile.deepseek-ocr-rtx4090 .
```

### Run interactively:
```bash
docker run -it --rm \
  --gpus all \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -v /path/to/pdfs:/data \
  deepseek-ocr-rtx4090:latest
```

### Process a PDF inside container:
```bash
cd /workspace/DeepSeek-OCR/DeepSeek-OCR-master/DeepSeek-OCR-vllm

# Edit config.py:
# INPUT_PATH = '/data/your-document.pdf'
# OUTPUT_PATH = '/data/output'

python run_dpsk_ocr_pdf.py
```

---

## Key Takeaways

1. **Always check the official repo first** - The DeepSeek-OCR team has working code that uses a different approach than the vLLM docs suggest

2. **CLI ≠ Python API** - Just because vLLM has a CLI doesn't mean all models work with it

3. **Model registration matters** - Custom models need manual registration, which CLI doesn't support

4. **V0 vs V1 is critical** - Set `VLLM_USE_V1='0'` before importing vLLM

5. **Exact versions matter** - DeepSeek-OCR requires specific dependency versions

6. **Documentation can be misleading** - vLLM docs mention DeepSeek-OCR support but don't clarify it's only via Python API with V0 engine

---

## References

- [DeepSeek-OCR Official Repo](https://github.com/deepseek-ai/DeepSeek-OCR)
- [vLLM Documentation](https://docs.vllm.ai/)
- [vLLM Model Registry Source](https://github.com/vllm-project/vllm/blob/main/vllm/model_executor/models/registry.py)

---

## Troubleshooting

**If you see "Model architectures ['DeepseekOCRForCausalLM'] are not supported":**
- ✅ You're using CLI approach - switch to Python API
- ✅ Check `VLLM_USE_V1` is set to `'0'`
- ✅ Verify model registration before LLM initialization

**If you see "cannot import name 'LlamaFlashAttention2'":**
- ✅ Install exact transformers version: `transformers==4.46.3`
- ✅ Clear HuggingFace cache: `rm -rf ~/.cache/huggingface/modules`

**If build fails on flash-attn:**
- ✅ Use `-devel` base image, not `-runtime`
- ✅ Use `--no-build-isolation` flag
- ✅ Ensure CUDA toolkit is available in container
