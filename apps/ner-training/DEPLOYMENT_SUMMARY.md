# NER Model Deployment Summary

**Date**: 2025-10-16
**Issue**: Triton serving wrong model (binary classifier instead of 9-label NER)

---

## Problem Identified

The `distilbert` model on Calypso Triton (192.168.2.110:8000) is a **binary classifier**:

```protobuf
output [
  {
    name: "logits"
    data_type: TYPE_FP32
    dims: [ 2 ]  // ❌ WRONG - should be [seq_len, 9]
  }
]
```

Expected for NER:
```protobuf
output [
  {
    name: "logits"
    data_type: TYPE_FP32
    dims: [ -1, 9 ]  // ✅ CORRECT - [sequence_length, 9 entity labels]
  }
]
```

---

## Solution Created

### 1. Training Infrastructure ✅

**Location**: `apps/ner-training/`

**Files**:
- `train_ner.py` - Fine-tune DistilBERT for NER with 9 labels
- `export_onnx.py` - Export trained model to ONNX format
- `config.pbtxt.template` - Triton model configuration
- `deploy.sh` - Automated deployment script
- `test_inference.py` - Test Triton predictions
- `requirements.txt` - Python dependencies
- `README.md` - Complete documentation

**Entity Labels** (Maritime/Seafood Domain):
```python
["O", "VESSEL", "HS_CODE", "PORT", "SPECIES", "IMO", "FLAG", "RISK_LEVEL", "DATE"]
```

### 2. Deployment Workflow

```bash
# Step 1: Setup environment
conda create -n ner-training python=3.10
conda activate ner-training
cd apps/ner-training
pip install -r requirements.txt

# Step 2: Prepare training data (export from Label Studio)
# Need 100+ annotated documents in JSONL format

# Step 3: Train model
python train_ner.py \
  --train data/train.jsonl \
  --val data/val.jsonl \
  --output models/ner-distilbert

# Step 4: Deploy to Triton
./deploy.sh models/ner-distilbert

# Step 5: Test predictions
python test_inference.py --model ner-distilbert
```

### 3. Integration with ls-triton-adapter

Once NER model is deployed:

**Update config**:
```bash
export DEFAULT_MODEL="ner-distilbert"
```

**Test integration**:
```bash
cd ../ls-triton-adapter
./integration_test.sh
```

Expected output: Entities detected (VESSEL, IMO, FLAG, etc.)

---

## Current Status

| Task | Status |
|------|--------|
| ✅ Identify problem | Complete |
| ✅ Create training infrastructure | Complete |
| ✅ Create ONNX export script | Complete |
| ✅ Create Triton config template | Complete |
| ✅ Create deployment automation | Complete |
| ⏭️ Collect training data | Pending - need 100+ annotations |
| ⏭️ Train NER model | Pending - waiting for data |
| ⏭️ Deploy to Triton | Pending - waiting for model |
| ⏭️ Update cluster config | Pending - after deployment |

---

## Next Steps

### Immediate: Collect Training Data

**Option A**: Export existing Label Studio annotations
```bash
# Use Label Studio API to export completed tasks
curl -X GET http://label-studio:8080/api/projects/1/export?exportType=JSON \
  -H "Authorization: Token <token>" \
  > data/annotations.json
```

**Option B**: Annotate sample documents manually
1. Upload 100+ vessel documents to Label Studio
2. Manually annotate entities (VESSEL, IMO, FLAG, etc.)
3. Export to JSONL format

**Option C**: Use synthetic data for initial model
- Generate synthetic vessel documents with entities
- Quick way to get started, but lower quality

### After Training Data is Ready

1. **Train model** (2-4 hours on GPU)
   ```bash
   python train_ner.py --train data/train.jsonl --val data/val.jsonl
   ```

2. **Evaluate** (check F1 > 0.85)

3. **Deploy** (automated)
   ```bash
   ./deploy.sh models/ner-distilbert
   ```

4. **Verify** (integration test)
   ```bash
   cd ../ls-triton-adapter && ./integration_test.sh
   ```

5. **Update cluster** (after successful test)
   ```yaml
   # clusters/tethys/apps/label-studio-release.yaml
   env:
     - name: DEFAULT_MODEL
       value: "ner-distilbert"
   ```

---

## Risk Mitigation

### Binary Classifier Deprecation

**Keep old model for now**:
```bash
# Rename instead of delete
ssh neptune@192.168.2.110
mv /models/distilbert /models/distilbert-binary-DEPRECATED
```

**After NER model is verified**:
```bash
# Remove deprecated model
rm -rf /models/distilbert-binary-DEPRECATED
```

### Rollback Plan

If NER model fails:
1. Rename NER model: `mv /models/ner-distilbert /models/ner-distilbert-FAILED`
2. Restore binary: `mv /models/distilbert-binary-DEPRECATED /models/distilbert`
3. Restart Triton: `docker restart triton-server`

---

## Technical Notes

### Model Architecture

**Input**:
- `input_ids`: INT64, shape `[batch, seq_len]`
- `attention_mask`: INT64, shape `[batch, seq_len]`

**Output**:
- `logits`: FP32, shape `[batch, seq_len, 9]`

**Post-processing** (done by ls-triton-adapter):
1. Softmax over 9 labels per token
2. Argmax to get predicted label ID
3. Convert token predictions to character spans
4. Merge consecutive tokens with same label
5. Return Label Studio format: `[{"start", "end", "text", "labels"}]`

### Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| F1 Score | > 0.85 | On validation set |
| Precision | > 0.80 | Minimize false positives |
| Recall | > 0.80 | Minimize false negatives |
| Latency | < 100ms | Per document on GPU |
| Throughput | > 100 docs/sec | Batch size 8 |

### Training Data Requirements

| Entity Type | Min Examples | Recommended |
|------------|-------------|-------------|
| VESSEL | 50 | 200+ |
| IMO | 30 | 100+ |
| FLAG | 30 | 100+ |
| PORT | 30 | 100+ |
| SPECIES | 20 | 50+ |
| HS_CODE | 20 | 50+ |
| RISK_LEVEL | 10 | 30+ |
| DATE | 10 | 30+ |

**Total**: 100+ documents with diverse entity combinations

---

## References

- **ls-triton-adapter**: `apps/ls-triton-adapter/`
- **Integration test**: `apps/ls-triton-adapter/integration_test.sh`
- **Test results**: `apps/ls-triton-adapter/INTEGRATION_TEST_RESULTS.md`
- **Triton docs**: https://github.com/triton-inference-server/server
- **DistilBERT**: https://huggingface.co/distilbert-base-uncased
