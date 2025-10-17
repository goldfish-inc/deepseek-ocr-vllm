# NER Model Training & Deployment

Train and deploy a DistilBERT NER model for vessel risk entity extraction.

## Entity Labels (9 classes)

Maritime/Seafood Domain:

- `O` - Outside any entity
- `VESSEL` - Vessel name
- `HS_CODE` - Harmonized System code
- `PORT` - Port name
- `SPECIES` - Fish/seafood species or fishing method
- `IMO` - IMO number
- `FLAG` - Vessel flag state
- `RISK_LEVEL` - Risk assessment level
- `DATE` - Date/timestamp

## Quick Start (Synthetic Data)

**Best for**: Getting started immediately with 1,761 vessel registry records

```bash
# 1. Export Label Studio tasks
./export_label_studio_tasks.sh label_studio_tasks.json

# 2. Generate synthetic training data
python generate_synthetic_data.py --input label_studio_tasks.json --output-dir data/

# 3. Train model
python train_ner.py --train data/synthetic_train.jsonl --val data/synthetic_val.jsonl --output models/ner-distilbert

# 4. Deploy to Triton
./deploy.sh models/ner-distilbert
```

**⚠️ Synthetic Data Limitations**:
- Template-based sentences (not naturalistic)
- No OCR noise, typos, or formatting variations
- Should be supplemented with real annotated documents for production

**Field Mapping**: See `field_mapping.yaml` for vessel field → entity label mapping

## Setup

```bash
# Create conda environment
conda create -n ner-training python=3.10
conda activate ner-training

# Install dependencies
pip install -r requirements.txt
```

## Training from Real Annotations

### 1. Prepare Data

Export annotations from Label Studio in JSONL format:

```json
{
  "text": "VESSEL: Arctic Explorer IMO: 1234567 FLAG: Norway",
  "annotations": [{
    "result": [
      {"type": "labels", "value": {"start": 8, "end": 23, "text": "Arctic Explorer", "labels": ["VESSEL"]}},
      {"type": "labels", "value": {"start": 29, "end": 36, "text": "1234567", "labels": ["IMO"]}},
      {"type": "labels", "value": {"start": 43, "end": 49, "text": "Norway", "labels": ["FLAG"]}}
    ]
  }]
}
```

### 2. Train Model

```bash
python train_ner.py \
  --train data/train.jsonl \
  --val data/val.jsonl \
  --output models/ner-distilbert \
  --epochs 5 \
  --batch-size 16
```

### 3. Export to ONNX

```bash
python export_onnx.py \
  --model models/ner-distilbert \
  --output triton-models/ner-distilbert/1/model.onnx
```

### 4. Create Triton Config

```bash
cp config.pbtxt.template triton-models/ner-distilbert/config.pbtxt
```

## Deployment to Triton

### Deploy to Calypso

```bash
# Copy model to Triton server
scp -r triton-models/ner-distilbert neptune@192.168.2.110:/models/

# Reload Triton (or restart container)
ssh neptune@192.168.2.110 'docker restart triton-server'
```

### Verify Deployment

```bash
# Check model loaded
curl http://192.168.2.110:8000/v2/models/ner-distilbert

# Expected output:
# {
#   "name": "ner-distilbert",
#   "outputs": [{"name": "logits", "shape": [-1, -1, 9]}]
# }
```

## Testing

```bash
# Test with sample text
curl -X POST http://192.168.2.110:8000/v2/models/ner-distilbert/infer \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": [
      {"name": "input_ids", "shape": [1, 20], "datatype": "INT64", "data": [...]},
      {"name": "attention_mask", "shape": [1, 20], "datatype": "INT64", "data": [...]}
    ]
  }'
```

Or use the integration test:

```bash
cd ../ls-triton-adapter
export DEFAULT_MODEL="ner-distilbert"
./integration_test.sh
```

## Model Performance

Target metrics (with 100+ annotated examples):
- **F1 Score**: > 0.85
- **Precision**: > 0.80
- **Recall**: > 0.80

Inference performance:
- **Latency**: < 100ms per document (GPU)
- **Throughput**: > 100 docs/sec (batch size 8)

## Troubleshooting

### Model Not Loading

Check Triton logs:
```bash
ssh neptune@192.168.2.110 'docker logs triton-server 2>&1 | tail -50'
```

Common issues:
- Wrong ONNX opset version (use 14)
- Model file too large (reduce max_seq_length)
- Config mismatch (verify dims match ONNX outputs)

### Poor Predictions

- Increase training data (aim for 100+ examples per entity type)
- Increase epochs (try 5-10)
- Adjust learning rate (try 3e-5 or 2e-5)
- Check label alignment (verify entity offsets match tokens)

## Next Steps

1. **Collect Training Data**: Annotate 100+ documents in Label Studio
2. **Train Initial Model**: Run training script
3. **Evaluate**: Check F1 score on validation set
4. **Deploy**: Export to ONNX and deploy to Triton
5. **Monitor**: Track prediction quality in production
6. **Iterate**: Collect hard examples and retrain
