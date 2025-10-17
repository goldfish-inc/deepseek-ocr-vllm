# Synthetic NER Training Data Generation - Session Summary

**Date**: 2025-10-17
**Task**: Generate synthetic NER training data from Label Studio vessel registry records

---

## What Was Created ✅

### Core Functionality

**`generate_synthetic_data.py`** - Converts structured vessel records to labeled NER training data
- Reads Label Studio task exports (JSON)
- Generates natural language sentences from templates
- Calculates character-level entity offsets
- Outputs Label Studio annotation format (JSONL)
- Tags with metadata for filtering during retraining
- Supports 80/20 train/validation split

**`field_mapping.yaml`** - Configures vessel field → entity label mapping
```yaml
field_mapping:
  "Name": "VESSEL"
  "IMO Number": "IMO"
  "Flag": "FLAG"
  "Port of Registry": "PORT"
  "Type": "SPECIES"  # Maritime/Seafood domain
  "Built in Year": "DATE"
```

**`export_label_studio_tasks.sh`** - Extracts all tasks from Label Studio database
- Attempts Label Studio API export (requires token)
- Falls back to direct database query if API unavailable
- Outputs JSON file for synthetic data generation

**`sample_tasks.json`** - Test dataset with 5 vessel records for validation

### Documentation Updates

**`README.md`** - Added "Quick Start (Synthetic Data)" section
- 4-step workflow: export → generate → train → deploy
- Documented limitations of synthetic data
- Reference to field mapping configuration

---

## How It Works

### Input Format

Label Studio task export:
```json
{
  "id": 1,
  "data": {
    "Name": "SOLOMON FISHER",
    "Flag": "Solomon Islands",
    "IMO Number": 8894720,
    "Port of Registry": "HONIARA",
    "Type": "Pole and Line",
    "Built in Year": 1987
  }
}
```

### Generated Output

Training example with entity annotations:
```json
{
  "id": 1,
  "text": "SOLOMON FISHER (IMO: 8894720) operates under Solomon Islands flag from HONIARA.",
  "annotations": [{
    "result": [
      {"value": {"start": 0, "end": 14, "text": "SOLOMON FISHER", "labels": ["VESSEL"]}},
      {"value": {"start": 21, "end": 28, "text": "8894720", "labels": ["IMO"]}},
      {"value": {"start": 45, "end": 60, "text": "Solomon Islands", "labels": ["FLAG"]}},
      {"value": {"start": 71, "end": 78, "text": "HONIARA", "labels": ["PORT"]}}
    ]
  }],
  "metadata": {
    "source": "synth_vessel_registry",
    "generation_timestamp": "2025-10-17T02:53:09Z",
    "original_task_id": 1,
    "synthetic": true
  }
}
```

### Text Templates (4 variants)

1. `"Vessel {Name} with IMO {IMO Number} is flagged in {Flag} and registered at port {Port of Registry}."`
2. `"{Name} (IMO: {IMO Number}) operates under {Flag} flag from {Port of Registry}."`
3. `"The {Type} vessel {Name} bears IMO number {IMO Number}, flag {Flag}, and is registered in {Port of Registry}."`
4. `"{Name}, a {Type} vessel built in {Built in Year}, has IMO {IMO Number} and flies the {Flag} flag."`

Templates are randomly selected per task to introduce variation.

---

## Usage

### Generate from Label Studio (1,761 tasks)

```bash
# 1. Export all tasks
cd apps/ner-training
./export_label_studio_tasks.sh label_studio_tasks.json

# 2. Generate synthetic dataset
python generate_synthetic_data.py \
  --input label_studio_tasks.json \
  --output-dir data/

# Output:
# - data/synthetic_train.jsonl (~1,409 examples)
# - data/synthetic_val.jsonl (~352 examples)
```

### Generate from Sample (5 tasks - testing)

```bash
python generate_synthetic_data.py \
  --input sample_tasks.json \
  --output-dir data/
```

### Train NER Model

```bash
python train_ner.py \
  --train data/synthetic_train.jsonl \
  --val data/synthetic_val.jsonl \
  --output models/ner-distilbert
```

---

## Validation ✅

**Test Run**: 5 sample vessel records
- **Input**: `sample_tasks.json`
- **Output**: 5 training examples, 0 validation examples
- **Entity types**: VESSEL (5), IMO (5), FLAG (5), PORT (5), SPECIES (2), DATE (1)
- **Format**: Valid Label Studio annotation format
- **Character offsets**: Correctly aligned

**Sample Generated Text**:
> "SOLOMON FISHER (IMO: 8894720) operates under Solomon Islands flag from HONIARA."

**Entities Detected**:
- `SOLOMON FISHER` → VESSEL (0:14)
- `8894720` → IMO (21:28)
- `Solomon Islands` → FLAG (45:60)
- `HONIARA` → PORT (71:78)

---

## Metadata Tagging

Each synthetic example includes:
```json
"metadata": {
  "source": "synth_vessel_registry",
  "generation_timestamp": "2025-10-17T02:53:09Z",
  "original_task_id": 1,
  "synthetic": true
}
```

**Purpose**: Enables filtering synthetic data during model retraining when real annotated documents become available.

**Filtering Example**:
```python
# Load only real annotations (exclude synthetic)
real_examples = [ex for ex in dataset if not ex.get("metadata", {}).get("synthetic", False)]

# Or load only synthetic
synthetic_examples = [ex for ex in dataset if ex.get("metadata", {}).get("synthetic", False)]
```

---

## Limitations ⚠️

### Not Covered by Synthetic Data

1. **OCR Noise**: Real documents may have scan artifacts, degraded text
2. **Typos & Misspellings**: Human errors in original documents
3. **Free-form Text**: Natural language descriptions, notes, comments
4. **Formatting Variations**: Tables, multi-column layouts, headers
5. **Contextual Entities**: Entities embedded in complex sentences
6. **Ambiguous Cases**: Entity boundaries in compound phrases

### Mitigation Strategy

1. **Immediate**: Use synthetic data to train initial NER model
2. **Short-term**: Deploy model, collect predictions on real documents
3. **Medium-term**: SME annotations on 100+ real documents
4. **Long-term**: Retrain with mixed dataset (synthetic + real), filter by metadata

---

## Next Steps

### Immediate: Train Model

```bash
cd apps/ner-training

# Export all 1,761 tasks
./export_label_studio_tasks.sh label_studio_tasks.json

# Generate synthetic dataset
python generate_synthetic_data.py --input label_studio_tasks.json

# Train model (2-4 hours on GPU)
python train_ner.py \
  --train data/synthetic_train.jsonl \
  --val data/synthetic_val.jsonl \
  --output models/ner-distilbert \
  --epochs 5

# Expected output:
# - models/ner-distilbert/pytorch_model.bin
# - models/ner-distilbert/config.json
# - models/ner-distilbert/tokenizer_config.json
```

### After Training: Deploy

```bash
# Export to ONNX and deploy to Triton
./deploy.sh models/ner-distilbert

# Test integration
cd ../ls-triton-adapter
export DEFAULT_MODEL="ner-distilbert"
./integration_test.sh

# Expected: Entities detected (VESSEL, IMO, FLAG, etc.)
```

### Production: Mixed Dataset

Once real annotations are available:
```bash
# Combine datasets
cat data/synthetic_train.jsonl data/real_train.jsonl > data/mixed_train.jsonl

# Retrain with higher weight on real data
python train_ner.py \
  --train data/mixed_train.jsonl \
  --val data/real_val.jsonl \
  --epochs 10 \
  --sample-weight-fn prioritize_real_annotations
```

---

## Files Created This Session

| File | Purpose | Lines |
|------|---------|-------|
| `generate_synthetic_data.py` | Main conversion script | ~330 |
| `field_mapping.yaml` | Field → label configuration | ~40 |
| `export_label_studio_tasks.sh` | Database export script | ~80 |
| `sample_tasks.json` | Test dataset (5 vessels) | ~50 |
| `README.md` (updated) | Quick start documentation | - |
| `SYNTHETIC_DATA_GENERATION_SUMMARY.md` | This file | ~250 |

**Total**: ~750 lines of code + documentation

---

## Performance Targets

After training on 1,761 synthetic examples:

| Metric | Expected | Notes |
|--------|----------|-------|
| **Training Accuracy** | > 0.90 | Synthetic data is clean |
| **Validation F1** | 0.70-0.80 | Templates limit generalization |
| **Real-world F1** | 0.50-0.65 | OCR noise, typos not represented |

**Improvement Path**: Retrain with 100+ real annotations → F1 > 0.85

---

## Key Design Decisions

### Why Synthetic Data First?

**Problem**: 1,761 Label Studio tasks, 0 annotations (webhook blocked SME input)

**Options**:
1. ❌ Wait for 100+ SME annotations (weeks of delay)
2. ✅ Generate synthetic data from structured vessel records (immediate)
3. ❌ Use pre-trained model (no maritime domain knowledge)

**Decision**: Synthetic data gets us "off zero today" while waiting for real annotations.

### Why Template-based Generation?

**Alternatives**:
1. GPT-4 text generation (expensive, API rate limits)
2. Random entity insertion (low quality, unrealistic)
3. ✅ Template-based (fast, predictable, version-controlled)

**Trade-off**: Less linguistic variety, but guaranteed entity coverage and label consistency.

### Why Metadata Tagging?

**Future Use Cases**:
- Filter synthetic data during retraining
- Compare synthetic vs. real model performance
- Track training data provenance for auditing
- Enable gradual transition to real annotations

---

## Questions Answered

**Q: Can we train a working NER model today?**
✅ **Yes** - Synthetic data generation is complete, ready to train

**Q: Will it work on real documents?**
⚠️ **Partially** - Expected F1 0.50-0.65 on real docs (synthetic training limitation)

**Q: How to improve accuracy?**
✅ **Add real annotations** - Retrain with 100+ SME-annotated documents → F1 > 0.85

**Q: How to extract all 1,761 tasks?**
✅ **Run export script** - `./export_label_studio_tasks.sh label_studio_tasks.json`

**Q: Can we filter synthetic data later?**
✅ **Yes** - All examples tagged with `"metadata": {"synthetic": true}`

---

## Success Criteria Met ✅

- [x] Convert structured vessel data → labeled NER format
- [x] Map fields to entity labels (version-controlled)
- [x] Tag examples with metadata (source, timestamp, task ID)
- [x] Document limitations (OCR, typos, free-form text)
- [x] Provide working examples (5 sample tasks validated)
- [x] Create export workflow (Label Studio → JSON)
- [x] Update README with quick start guide

**Status**: Ready to train NER model with synthetic data! 🚀

---

## User Requirements (from approval)

> "Turning those 1,761 structured records into synthetic labeled sentences gives us an immediate training set, a working NER model, and a way to exercise the full pre-annotation pipeline end-to-end."

✅ **Achieved**

> "Note the caveats: Synthetic data won't cover quirks of real documents (OCR noise, typos, free-form text)"

✅ **Documented** (see Limitations section)

> "Capture which fields map to which labels (VESSEL, IMO, FLAG, PORT). Keep that mapping in version control."

✅ **Completed** (`field_mapping.yaml` in git)

> "Tag each synthetic example with metadata (source=synth_vessel_registry, generation timestamp)"

✅ **Implemented** (all examples include metadata)

> "This gets us off zero today, and we can fold in SME-annotated text as it arrives to improve realism."

✅ **Workflow documented** (see "Production: Mixed Dataset")

---

**End of Summary**
