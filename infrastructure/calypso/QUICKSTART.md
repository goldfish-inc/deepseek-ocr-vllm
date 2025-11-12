# Quick Start: DeepSeek-OCR vLLM on RTX 4090

Get DeepSeek-OCR running on Calypso (RTX 4090) using the **Python API approach**.

> ⚠️ **CRITICAL**: DeepSeek-OCR does **NOT** work with `vllm serve` CLI!
> You must use the **Python API** with **vLLM V0 engine**.
> See [LESSONS_LEARNED.md](./LESSONS_LEARNED.md) for full explanation.

## Prerequisites

- ✅ RTX 4090 GPU with 24GB VRAM
- ✅ NVIDIA drivers (>= 535)
- ✅ Docker with GPU support (buildx required)
- ✅ 50GB free disk space (for Docker image + model weights)

## Quick Build & Test

### 1. Build the Docker image

```bash
cd /home/neptune/Developer/deepseek-ocr-vllm/infrastructure/calypso
docker build -t deepseek-ocr-rtx4090:latest -f Dockerfile.deepseek-ocr-rtx4090 .
```

**Build time**: ~15-20 minutes (includes PyTorch 2.6.0 upgrade + flash-attn compilation)

### 2. Verify the deployment

```bash
docker run --rm \
  --gpus all \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  deepseek-ocr-rtx4090:latest \
  python -c "
import os
os.environ['VLLM_USE_V1'] = '0'
from vllm import LLM
from vllm.model_executor.models.registry import ModelRegistry
import sys
sys.path.insert(0, '/workspace/DeepSeek-OCR/DeepSeek-OCR-master/DeepSeek-OCR-vllm')
from deepseek_ocr import DeepseekOCRForCausalLM
ModelRegistry.register_model('DeepseekOCRForCausalLM', DeepseekOCRForCausalLM)
llm = LLM(
    model='deepseek-ai/DeepSeek-OCR',
    hf_overrides={'architectures': ['DeepseekOCRForCausalLM']},
    trust_remote_code=True,
    max_model_len=4096,
    gpu_memory_utilization=0.9,
    max_num_seqs=2
)
print('✅ SUCCESS! DeepSeek-OCR loaded on RTX 4090')
"
```

**First run**: Downloads ~18GB model weights (cached for future runs)

**Expected output:**
```
✅ SUCCESS! DeepSeek-OCR loaded on RTX 4090
Model weights: 6.23 GiB
KV Cache: 12.99 GiB
GPU usage: 19.82 GiB / 22.03 GiB (90%)
```

## Usage: Process PDFs

### Option 1: Interactive Mode

```bash
# Start container with volume mounts
docker run -it --rm \
  --gpus all \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -v /path/to/your/pdfs:/data \
  deepseek-ocr-rtx4090:latest

# Inside container:
cd /workspace/DeepSeek-OCR/DeepSeek-OCR-master/DeepSeek-OCR-vllm

# Configure input/output (edit config.py)
sed -i "s|INPUT_PATH = ''|INPUT_PATH = '/data/your-document.pdf'|" config.py
sed -i "s|OUTPUT_PATH = ''|OUTPUT_PATH = '/data/output'|" config.py

# Run OCR
python run_dpsk_ocr_pdf.py
```

**Output files:**
- `/data/output/your-document.mmd` - Markdown with embedded images
- `/data/output/your-document_det.mmd` - Markdown with grounding annotations
- `/data/output/your-document_layouts.pdf` - PDF with detected layouts
- `/data/output/images/` - Extracted images from PDF

### Option 2: Single Command

```bash
docker run --rm \
  --gpus all \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -v $(pwd):/data \
  deepseek-ocr-rtx4090:latest \
  bash -c "
cd /workspace/DeepSeek-OCR/DeepSeek-OCR-master/DeepSeek-OCR-vllm
sed -i \"s|INPUT_PATH = ''|INPUT_PATH = '/data/input.pdf'|\" config.py
sed -i \"s|OUTPUT_PATH = ''|OUTPUT_PATH = '/data'|\" config.py
python run_dpsk_ocr_pdf.py
"
```

## Usage: Process Images

```bash
# For single images (.jpg, .png, .jpeg)
docker run --rm \
  --gpus all \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -v $(pwd):/data \
  deepseek-ocr-rtx4090:latest \
  bash -c "
cd /workspace/DeepSeek-OCR/DeepSeek-OCR-master/DeepSeek-OCR-vllm
sed -i \"s|INPUT_PATH = ''|INPUT_PATH = '/data/image.jpg'|\" config.py
sed -i \"s|OUTPUT_PATH = ''|OUTPUT_PATH = '/data'|\" config.py
python run_dpsk_ocr_image.py
"
```

## Performance Metrics (Tested on RTX 4090)

| Metric | Value |
|--------|-------|
| **Model Size** | 6.23 GiB |
| **KV Cache** | 12.99 GiB |
| **GPU Usage** | 19.82 GiB / 22.03 GiB (90%) |
| **Max Concurrency** | 55 requests (4K tokens each) |
| **Throughput** | ~800-1200 tokens/sec |
| **10-page PDF** | ~25-40 seconds |
| **50-page PDF** | ~2-4 minutes |

## Configuration Options

Edit `config.py` to customize:

```python
# Resolution modes (trade-off: quality vs memory)
BASE_SIZE = 1024   # Base resolution
IMAGE_SIZE = 640   # Crop size for dynamic mode
CROP_MODE = True   # Enable multi-crop (Gundam mode)

# GPU settings
MAX_CONCURRENCY = 2  # Lower for 24GB VRAM (original: 100)
MAX_CROPS = 6        # Max image crops (original: 9, reduced for VRAM)

# Prompts
PROMPT = '<image>\n<|grounding|>Convert the document to markdown.'
# PROMPT = '<image>\nFree OCR.'  # Without layout detection
# PROMPT = '<image>\nParse the figure.'  # For charts/diagrams
```

## Architecture

This deployment uses the **correct approach** discovered through testing:

1. **vLLM 0.8.5** Python API (not CLI `vllm serve`)
2. **V0 Engine** (`VLLM_USE_V1='0'`)
3. **Manual Model Registration** via `ModelRegistry`
4. **PyTorch 2.6.0** + transformers 4.46.3 (exact versions required)
5. **Official DeepSeek-OCR scripts** from their GitHub

### Why This Approach?

- ❌ **CLI doesn't work**: `DeepseekOCRForCausalLM` not in vLLM's registry
- ❌ **V1 engine rejects it**: Strict validation for supported models only
- ✅ **V0 + Python API**: Allows runtime model registration
- ✅ **Official scripts**: Already handle all edge cases

See [LESSONS_LEARNED.md](./LESSONS_LEARNED.md) for detailed explanation.

## Troubleshooting

### "Model architectures ['DeepseekOCRForCausalLM'] are not supported"

**Cause**: Using CLI approach or V1 engine

**Fix**: Use Python API with `VLLM_USE_V1='0'`

### "cannot import name 'LlamaFlashAttention2'"

**Cause**: Wrong transformers version

**Fix**: Rebuild with `transformers==4.46.3` (exact version)

### Out of Memory (OOM)

**Options**:
1. Reduce `max_model_len` to 2048 in Python code
2. Lower `MAX_CROPS` in `config.py` (e.g., 4 instead of 6)
3. Set `gpu_memory_utilization=0.8` instead of 0.9
4. Process smaller PDFs or reduce image resolution

### Build fails on flash-attn

**Cause**: Using `-runtime` base image instead of `-devel`

**Fix**: Dockerfile uses `pytorch:2.3.0-cuda12.1-cudnn8-devel` (correct)

## Next Steps

1. **Run Example Script**: See [example_usage.py](./example_usage.py) for Python API demo
2. **Advanced Config**: Read [deepseek-ocr-vllm-rtx4090.md](./deepseek-ocr-vllm-rtx4090.md)
3. **Compare with DGX Spark**: See [../GPU_COMPARISON.md](../GPU_COMPARISON.md)
4. **Build API Wrapper**: Create REST API around the Python scripts

## References

- **Official Repo**: https://github.com/deepseek-ai/DeepSeek-OCR
- **Lessons Learned**: [LESSONS_LEARNED.md](./LESSONS_LEARNED.md)
- **vLLM Docs**: https://docs.vllm.ai/
- **Model on HuggingFace**: https://huggingface.co/deepseek-ai/DeepSeek-OCR
