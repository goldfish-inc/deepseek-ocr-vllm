#!/usr/bin/env bash
set -euo pipefail

# Smoke test: tiny NER train + ONNX export using modern Transformers
# - Creates/updates conda env from apps/ner-training/environment.yml
# - Trains 1 epoch on small subset
# - Exports ONNX (opset 14) and prints IO signatures

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NER_DIR="$ROOT_DIR/apps/ner-training"
ENV_YML="$NER_DIR/environment.yml"
ENV_NAME="oceanid-ner-py311"

RUNNER=""
if command -v conda >/dev/null 2>&1; then
  RUNNER="conda"
elif command -v micromamba >/dev/null 2>&1; then
  RUNNER="micromamba"
else
  echo "Neither conda nor micromamba found. Install Miniconda or micromamba and retry." >&2
  exit 1
fi

echo "🔧 Ensuring $RUNNER environment: $ENV_NAME"
if [ "$RUNNER" = "conda" ]; then
  if conda env list | grep -q "^$ENV_NAME\s"; then
    echo "  → updating env from $ENV_YML"
    conda env update -n "$ENV_NAME" -f "$ENV_YML" -q || true
  else
    if command -v mamba >/dev/null 2>&1; then
      echo "  → creating env with mamba"
      mamba env create -f "$ENV_YML"
    else
      echo "  → creating env with conda"
      conda env create -f "$ENV_YML"
    fi
  fi
  PY="conda run -n $ENV_NAME python"
else
  # micromamba
  if micromamba env list | grep -q "^$ENV_NAME\s"; then
    echo "  → updating env from $ENV_YML"
    micromamba env update -n "$ENV_NAME" -f "$ENV_YML" -y || true
  else
    echo "  → creating env with micromamba"
    micromamba env create -f "$ENV_YML" -y
  fi
  PY="micromamba run -n $ENV_NAME python"
fi

echo "📦 Verifying key package versions"
$PY - <<'PY'
import importlib
mods = [
    ('transformers','__version__'),
    ('tokenizers','__version__'),
    ('torch','__version__'),
    ('onnx','__version__'),
    ('onnxruntime','__version__'),
    ('accelerate','__version__'),
]
for name, attr in mods:
    m = importlib.import_module(name)
    print(f"  {name}: {getattr(m, attr, 'n/a')}")
from transformers import TrainingArguments
TrainingArguments(output_dir='tmp', eval_strategy='no', save_strategy='epoch')
print('  TrainingArguments: OK')
PY

WORK=/tmp/oceanid-ner-smoke
mkdir -p "$WORK"
TRAIN_JSONL="$WORK/train.jsonl"
VAL_JSONL="$WORK/val.jsonl"
OUT_DIR="$WORK/model"
ONNX_DIR="$WORK/onnx"

echo "🧪 Preparing tiny dataset subsets"
# Generate minimal synthetic data if files don't exist
if [ -f "$NER_DIR/data/synthetic_train.jsonl" ] && [ -f "$NER_DIR/data/synthetic_val.jsonl" ]; then
  echo "  → using existing data files"
  head -n 120 "$NER_DIR/data/synthetic_train.jsonl" > "$TRAIN_JSONL"
  head -n 40 "$NER_DIR/data/synthetic_val.jsonl" > "$VAL_JSONL"
else
  # Generate minimal inline fixtures for CI
  echo "  → generating synthetic data to $WORK/"
  GEN_PY="${WORK}/gen_synth.py"
  cat > "$GEN_PY" <<'PYGEN'
import json
import random
import sys

work_dir = sys.argv[1]

# Minimal synthetic examples
templates = [
    ("VESSEL Oceanic Voyager IMO 1234567 departed PORT Santos on DATE 2025-10-15 with SPECIES Tuna under FLAG Panama",
     [(0,6,"VESSEL"), (7,23,"VESSEL"), (28,35,"IMO"), (45,49,"PORT"), (50,56,"PORT"), (60,64,"DATE"), (65,75,"DATE"), (81,88,"SPECIES"), (89,93,"SPECIES"), (100,104,"FLAG"), (105,111,"FLAG")]),
    ("FLAG Chinese vessel VESSEL Star Harbor transported SPECIES Mackerel HS_CODE 030354 to PORT Tokyo",
     [(0,4,"FLAG"), (5,12,"FLAG"), (20,26,"VESSEL"), (27,38,"VESSEL"), (51,58,"SPECIES"), (59,67,"SPECIES"), (68,75,"HS_CODE"), (76,82,"HS_CODE"), (86,90,"PORT"), (91,96,"PORT")]),
]

def generate_task(text, entities):
    return {"data": {"text": text}, "annotations": [{"result": [
        {"value": {"start": s, "end": e, "text": text[s:e], "labels": [l]}, "from_name": "label", "to_name": "text", "type": "labels"}
        for s, e, l in entities
    ]}]}

train_data = [generate_task(*random.choice(templates)) for _ in range(120)]
val_data = [generate_task(*random.choice(templates)) for _ in range(40)]

with open(f"{work_dir}/train.jsonl", "w", encoding="utf-8") as f:
    for task in train_data:
        f.write(json.dumps(task, ensure_ascii=False) + "\n")
with open(f"{work_dir}/val.jsonl", "w", encoding="utf-8") as f:
    for task in val_data:
        f.write(json.dumps(task, ensure_ascii=False) + "\n")
print(f"Generated {len(train_data)} train + {len(val_data)} val samples at {work_dir}")
PYGEN
  $PY "$GEN_PY" "$WORK"
  rm -f "$GEN_PY"
  echo "  → verifying generated files:"
  ls -lh "$TRAIN_JSONL" "$VAL_JSONL" || echo "ERROR: files not created!"
fi

echo "🏋️  Training 1 epoch (tiny subset)"
$PY "$NER_DIR/train_ner.py" \
  --train "$TRAIN_JSONL" \
  --val "$VAL_JSONL" \
  --output "$OUT_DIR" \
  --epochs 1 \
  --batch-size 4 \
  --learning-rate 5e-5

echo "📤 Exporting to ONNX (opset 14)"
$PY "$NER_DIR/export_onnx.py" \
  --model "$OUT_DIR" \
  --output "$ONNX_DIR" \
  --opset 14

echo "🔎 ONNX IO signatures"
$PY - <<PY
import onnx, json
m = onnx.load("$ONNX_DIR/model.onnx")
print("Inputs:")
for i in m.graph.input:
    print(" -", i.name, i.type.tensor_type.elem_type, [d.dim_param or d.dim_value for d in i.type.tensor_type.shape.dim])
print("Outputs:")
for o in m.graph.output:
    print(" -", o.name, o.type.tensor_type.elem_type, [d.dim_param or d.dim_value for d in o.type.tensor_type.shape.dim])
PY

if [ -f "$ONNX_DIR/exporter_mode.txt" ]; then
  echo "Exporter mode: $(cat "$ONNX_DIR/exporter_mode.txt")"
else
  echo "Exporter mode: unknown (marker not found)"
fi

echo "✅ Smoke NER: train + ONNX export completed"
