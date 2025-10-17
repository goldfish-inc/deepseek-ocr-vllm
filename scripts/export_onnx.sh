#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <hf-or-local-model-dir> <out-dir> [opset=14]"
  exit 1
fi

MODEL_DIR="$1"
OUT_DIR="$2"
OPSET="${3:-14}"

mkdir -p "$OUT_DIR"

# Prefer project export script (torch.onnx) over Optimum
if [ -f "apps/ner-training/export_onnx.py" ]; then
  python apps/ner-training/export_onnx.py \
    --model "$MODEL_DIR" \
    --output "$OUT_DIR" \
    --opset "$OPSET"
  echo "ONNX exported to $OUT_DIR"
  exit 0
fi

echo "Project exporter not found at apps/ner-training/export_onnx.py" >&2
echo "Please run from repository root or call the exporter directly." >&2
exit 1
