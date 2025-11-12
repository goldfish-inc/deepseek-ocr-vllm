#!/usr/bin/env python3
"""
Example: Using DeepSeek-OCR vLLM on RTX 4090

This script demonstrates the correct way to use DeepSeek-OCR with vLLM.

Requirements:
- Container built from Dockerfile.deepseek-ocr-rtx4090
- RTX 4090 or similar GPU with 24GB VRAM
"""

import os
import sys

# CRITICAL: Set V0 engine BEFORE importing vLLM
os.environ['VLLM_USE_V1'] = '0'
os.environ['CUDA_VISIBLE_DEVICES'] = '0'

from vllm import LLM, SamplingParams
from vllm.model_executor.models.registry import ModelRegistry

# Add DeepSeek-OCR code to path
sys.path.insert(0, '/workspace/DeepSeek-OCR/DeepSeek-OCR-master/DeepSeek-OCR-vllm')

from deepseek_ocr import DeepseekOCRForCausalLM
from process.ngram_norepeat import NoRepeatNGramLogitsProcessor
from process.image_process import DeepseekOCRProcessor

print("=" * 60)
print("DeepSeek-OCR vLLM Initialization")
print("=" * 60)

# Step 1: Register the custom model
print("\n[1/3] Registering DeepseekOCRForCausalLM model...")
ModelRegistry.register_model("DeepseekOCRForCausalLM", DeepseekOCRForCausalLM)

# Step 2: Initialize vLLM with RTX 4090 optimizations
print("[2/3] Initializing vLLM (this may take 20-30 seconds)...")
llm = LLM(
    model='deepseek-ai/DeepSeek-OCR',
    hf_overrides={'architectures': ['DeepseekOCRForCausalLM']},
    block_size=256,
    enforce_eager=False,
    trust_remote_code=True,
    max_model_len=4096,  # Reduced from 8192 for RTX 4090
    swap_space=0,
    max_num_seqs=2,  # Conservative for 24GB VRAM
    tensor_parallel_size=1,
    gpu_memory_utilization=0.9,
    disable_mm_preprocessor_cache=True
)

print("[3/3] Model loaded successfully!")

# Step 3: Configure sampling with n-gram prevention
logits_processors = [
    NoRepeatNGramLogitsProcessor(
        ngram_size=20,
        window_size=50,
        whitelist_token_ids={128821, 128822}  # <td>, </td>
    )
]

sampling_params = SamplingParams(
    temperature=0.0,
    max_tokens=4096,
    logits_processors=logits_processors,
    skip_special_tokens=False,
    include_stop_str_in_output=True,
)

print("\n" + "=" * 60)
print("✅ DeepSeek-OCR Ready!")
print("=" * 60)
print(f"Model: {llm.llm_engine.model_config.model}")
print(f"vLLM Version: 0.8.5 (V0 engine)")
print(f"Max Tokens: 4096")
print(f"GPU Utilization: 90%")
print("=" * 60)

# Example: Process a text prompt (without image)
print("\n[Example] Testing text-only inference...")
test_prompt = "Hello, are you working?"
outputs = llm.generate(
    [{"prompt": test_prompt, "multi_modal_data": {}}],
    sampling_params=sampling_params
)

print(f"\nPrompt: {test_prompt}")
print(f"Response: {outputs[0].outputs[0].text}")

print("\n" + "=" * 60)
print("Next steps:")
print("1. Use run_dpsk_ocr_image.py for single images")
print("2. Use run_dpsk_ocr_pdf.py for PDF documents")
print("3. Edit config.py to set INPUT_PATH and OUTPUT_PATH")
print("=" * 60)
