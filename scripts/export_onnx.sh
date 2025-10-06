#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "Usage: $0 <hf-or-local-model-dir> <out-dir> <num-labels>"
  exit 1
fi

MODEL_DIR="$1"
OUT_DIR="$2"
NUM_LABELS="$3"

python -m pip install --upgrade pip >/dev/null 2>&1 || true
python -m pip install "optimum[exporters]" onnxruntime >/dev/null 2>&1 || true

mkdir -p "$OUT_DIR"
optimum-cli export onnx --model "$MODEL_DIR" \
  --task token-classification \
  --num_labels "$NUM_LABELS" \
  "$OUT_DIR"

echo "ONNX exported to $OUT_DIR"
