# NER Model - Quick Start Guide

## The Problem

Integration test revealed Triton is serving a **binary classifier** (2 outputs) instead of the required **NER model** (9 entity labels).

```bash
# Current model output shape
curl http://192.168.2.110:8000/v2/models/distilbert
# {"outputs": [{"dims": [2]}]}  ❌ WRONG

# Expected NER output shape
# {"outputs": [{"dims": [-1, 9]}]}  ✅ CORRECT
```

---

## The Solution

Three-step process to deploy the correct NER model:

### Step 1: Collect Training Data (Required)

Export 100+ annotated documents from Label Studio:

```bash
# Option A: Export from Label Studio API
curl -X GET "http://label-studio:8080/api/projects/1/export?exportType=JSON" \
  -H "Authorization: Token YOUR_TOKEN" \
  > data/annotations.json

# Option B: Manual annotation
# 1. Upload documents to Label Studio
# 2. Annotate entities (VESSEL, IMO, FLAG, PORT, SPECIES, etc.)
# 3. Export as JSONL

# Option C: Generate synthetic data (for testing)
# See README.md for synthetic data generation script
```

### Step 2: Train NER Model

```bash
# Setup environment (one-time)
conda create -n ner-training python=3.10
conda activate ner-training
pip install -r requirements.txt

# Train model
python train_ner.py \
  --train data/train.jsonl \
  --val data/val.jsonl \
  --output models/ner-distilbert \
  --epochs 5

# Training time: 2-4 hours on GPU, 8-12 hours on CPU
```

### Step 3: Deploy to Triton

```bash
# Automated deployment (exports ONNX, copies to Triton, restarts)
./deploy.sh models/ner-distilbert

# Manual deployment (if needed)
python export_onnx.py --model models/ner-distilbert --output triton-models/ner-distilbert/1/model.onnx
scp -r triton-models/ner-distilbert neptune@192.168.2.110:/models/
ssh neptune@192.168.2.110 'docker restart triton-server'
```

---

## Verification

### Test Triton Directly

```bash
# Check model loaded
curl http://192.168.2.110:8000/v2/models/ner-distilbert

# Expected:
# {
#   "name": "ner-distilbert",
#   "outputs": [{"name": "logits", "shape": [-1, -1, 9]}]
# }

# Test inference
python test_inference.py \
  --text "VESSEL: Arctic Explorer IMO: 1234567 FLAG: Norway"

# Expected: Entities detected (VESSEL, IMO, FLAG)
```

### Test Integration with ls-triton-adapter

```bash
cd ../ls-triton-adapter
export DEFAULT_MODEL="ner-distilbert"
./integration_test.sh

# Expected output:
# ✅ Entities found: 3
# - VESSEL: "Arctic Explorer"
# - IMO: "1234567"
# - FLAG: "Norway"
```

---

## Deployment to Production

After successful testing:

```bash
# 1. Update cluster config
vim ../../clusters/tethys/apps/label-studio-release.yaml

# Change:
# env:
#   - name: DEFAULT_MODEL
#     value: "ner-distilbert"  # Was: "distilbert"

# 2. Commit and push (triggers GitHub Actions deployment)
git add clusters/tethys/apps/label-studio-release.yaml
git commit -m "feat: deploy NER model for pre-annotation"
git push origin main

# 3. Monitor deployment
kubectl -n apps get pods -l app=ls-triton-adapter -w
```

---

## Troubleshooting

### "Not enough training data"
**Need**: 100+ annotated documents (10+ examples per entity type)
**Solution**: Use Label Studio to annotate more documents

### "Model not loading on Triton"
**Check**: Triton logs
```bash
ssh neptune@192.168.2.110 'docker logs triton-server 2>&1 | tail -50'
```
**Common issues**:
- Wrong ONNX opset (use opset 14)
- Config mismatch (verify `config.pbtxt` matches ONNX output shape)

### "Poor prediction quality"
**Metrics**: F1 < 0.85
**Solutions**:
1. Collect more training data
2. Increase training epochs (try 10)
3. Check label alignment in training script

---

## File Structure

```
apps/ner-training/
├── train_ner.py              # Fine-tune DistilBERT for NER
├── export_onnx.py             # Export to ONNX format
├── test_inference.py          # Test Triton predictions
├── deploy.sh                  # Automated deployment
├── config.pbtxt.template      # Triton config
├── requirements.txt           # Python dependencies
├── README.md                  # Full documentation
├── DEPLOYMENT_SUMMARY.md      # Technical details
└── QUICK_START.md             # This file

data/                          # Training data (create manually)
├── train.jsonl                # Training annotations
└── val.jsonl                  # Validation annotations

models/ner-distilbert/         # Trained model (created by train_ner.py)
└── pytorch_model.bin

triton-models/ner-distilbert/  # Triton deployment (created by export_onnx.py)
├── config.pbtxt
└── 1/
    └── model.onnx
```

---

## Quick Command Reference

```bash
# Train
python train_ner.py --train data/train.jsonl --output models/ner-distilbert

# Deploy
./deploy.sh models/ner-distilbert

# Test
python test_inference.py --model ner-distilbert

# Integrate
cd ../ls-triton-adapter && ./integration_test.sh
```

---

## Next Action

**BLOCKER**: Need training data (100+ annotated documents)

**Where to get it**:
1. Export from existing Label Studio annotations
2. Annotate new documents in Label Studio
3. Generate synthetic data for initial testing

**Once you have data**: Run training script and deployment is automated ✨
