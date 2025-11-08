# Vessel NER Pipeline - Complete Workplan

## Architecture: Parquet-First Data Pipeline

**Key Principle**: Keep data in Parquet format throughout. PostgreSQL ONLY for final web/UI database (Crunchy Bridge).

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Stage 1: DeepSeek OCR (Already Complete)                       │
│ Repo: goldfish-inc/deepseekocr-output                          │
└─────────────────────────────────────────────────────────────────┘
  PDFs → DeepSeek HF Space → *.parquet files
  Schema: {clean_text, raw_text, metadata, pdf_name, page_number}
  Status: ✅ 191 documents processed
  Location: HuggingFace (saves VPS space)

┌─────────────────────────────────────────────────────────────────┐
│ Stage 2: Claude Pre-Annotation                                 │
│ Repo: goldfish-inc/deepseekocr-preannotated                    │
└─────────────────────────────────────────────────────────────────┘
  Script: preannotate_with_claude.py
  Input: Read from goldfish-inc/deepseekocr-output
  Process: Claude API extracts 50+ entity types
  Output: Write *.parquet to HF with entities_claude column
  Storage: HuggingFace (NOT VPS - saves space)

  Schema:
    - text: str (OCR output)
    - document_id: str (pdf_name_page_N)
    - entities_claude: List[{label, text, start, end, confidence}]
    - entities_by_category: Dict (grouped by taxonomy)
    - metadata: {pdf_name, page_number, has_tables, preannotated_by, etc}

┌─────────────────────────────────────────────────────────────────┐
│ Stage 3: Argilla SME Annotation                                │
│ Server: label.boathou.se (PostgreSQL internal - temporary)     │
└─────────────────────────────────────────────────────────────────┘
  Script: import_to_argilla.py
  Input: Read from goldfish-inc/deepseekocr-preannotated
  Process: Load into Argilla with Claude suggestions
  UI: SMEs review/correct/accept entities
  Note: Argilla PostgreSQL is ephemeral - NOT source of truth

┌─────────────────────────────────────────────────────────────────┐
│ Stage 4: Export Training Data                                  │
│ Repo: goldfish-inc/vessel-ner-training                         │
└─────────────────────────────────────────────────────────────────┘
  Script: export_training_data.py
  Input: Export from Argilla (with SME responses)
  Output: Write *.parquet to HF with entities_final column
  Storage: HuggingFace (NOT VPS)

  Schema:
    - text, document_id (same)
    - entities_final: List (SME-validated ground truth)
    - entities_claude: List (preserved for comparison)
    - annotation_metadata: {annotator, corrections, metrics}

┌─────────────────────────────────────────────────────────────────┐
│ Stage 5: PostgreSQL Ingestion (FINAL - Web/UI Only)            │
│ Database: Crunchy Bridge (labelfish)                           │
└─────────────────────────────────────────────────────────────────┘
  Script: ingest_to_postgres.py
  Input: Read from goldfish-inc/vessel-ner-training
  Process: Parse entities → structured vessel records
  Output: INSERT INTO vessels, owners, rfmo_authorizations, etc.
  Purpose: ONLY for web application queries
```

## 50+ Entity Types (Full Taxonomy)

### Core Identifiers
- VESSEL_NAME
- IMO_NUMBER
- MMSI
- IRCS_CALL_SIGN
- FLAG_STATE
- NATIONAL_REGISTRY_NUMBER
- EU_CFR_NUMBER

### Vessel Specifications
- VESSEL_TYPE
- TONNAGE
- LENGTH
- ENGINE_POWER
- BUILD_YEAR
- BUILDER_NAME
- HULL_NUMBER

### Ownership & Operation
- OWNER_NAME
- OWNER_ADDRESS
- OPERATOR_NAME
- BENEFICIAL_OWNER
- CHARTER_COMPANY
- REGISTRATION_PORT

### Compliance & Authorization
- RFMO_NAME
- AUTHORIZATION_NUMBER
- LICENSE_NUMBER
- PERMIT_TYPE
- VALIDITY_PERIOD
- AUTHORIZED_AREA
- AUTHORIZED_SPECIES

### Watchlist & Risk
- IUU_LISTING
- SANCTION_TYPE
- VIOLATION_TYPE
- DETENTION_PORT
- INSPECTION_DATE

### Species & Catch
- SPECIES_NAME
- SPECIES_CODE
- CATCH_QUANTITY
- CATCH_UNIT
- FISHING_GEAR_TYPE

### Historical Events
- PREVIOUS_NAME
- PREVIOUS_FLAG
- NAME_CHANGE_DATE
- FLAG_CHANGE_DATE
- OWNERSHIP_TRANSFER_DATE

### Geographic & Temporal
- PORT_NAME
- COORDINATES
- DATE
- REPORTING_PERIOD

### Organizations & Officials
- GOVERNMENT_AGENCY
- INSPECTION_AUTHORITY
- CERTIFYING_BODY
- OFFICIAL_NAME
- OFFICIAL_TITLE

## Implementation Phases

### Phase 1: Setup HuggingFace Repos
```bash
# Create repos via HF web UI or CLI
huggingface-cli repo create goldfish-inc/deepseekocr-preannotated --type dataset --private
huggingface-cli repo create goldfish-inc/vessel-ner-training --type dataset --private
```

### Phase 2: Claude Pre-Annotation Script
File: `preannotate_with_claude.py`
- Reads from goldfish-inc/deepseekocr-output (191 parquet files)
- Calls Claude API with full entity taxonomy
- Writes to goldfish-inc/deepseekocr-preannotated
- **DO NOT reprocess PDFs** - use existing DeepSeek output

### Phase 3: Argilla Import Script
File: `import_to_argilla.py`
- Reads from goldfish-inc/deepseekocr-preannotated
- Creates Argilla dataset with NER schema (already deployed)
- Loads records with Claude suggestions

### Phase 4: Training Data Export Script
File: `export_training_data.py`
- Exports from Argilla with SME responses
- Computes quality metrics (Claude vs SME)
- Writes to goldfish-inc/vessel-ner-training

### Phase 5: PostgreSQL Ingestion (Later)
File: `ingest_to_postgres.py`
- Parse entities into structured records
- Insert into Crunchy Bridge for web/UI

## Secrets Configuration

### Pulumi ESC (oceanid-cluster)
- `anthropicApiKey`: Claude API key ✅ DONE
- `huggingFaceToken`: HF API token (already exists)

### 1Password References
- Claude API: `op://ddqqn2cxmgi4xl4rris4mztwea/wxyb77364ixrechrwzvnno6okm/credential`
- HF Token: `op://ddqqn2cxmgi4xl4rris4mztwea/Hugging Face GOLDFISH ORG API Token/user access token`

## Current Status

### ✅ Completed
1. Fixed HF dataset metadata (README.md)
2. Dataset loads successfully (191 records)
3. Argilla importer with full NER schema deployed
4. Anthropic API key in Pulumi ESC
5. HuggingFace authentication configured

### 🔄 In Progress
- Creating HF repos for preannotated and training data

### ⏳ Pending
1. Build preannotate_with_claude.py
2. Test on 5 samples
3. Process all 191 documents
4. Build import_to_argilla.py
5. Build export_training_data.py

## HuggingFace CLI Reference

### Authentication
```bash
# Login
huggingface-cli login --token $HF_TOKEN

# Or using new CLI
hf auth login
```

### Repo Operations
```bash
# Create dataset repo
huggingface-cli repo create goldfish-inc/repo-name --type dataset --private

# Upload files
huggingface-cli upload goldfish-inc/repo-name /local/path/*.parquet

# Download dataset
huggingface-cli download goldfish-inc/repo-name
```

### Python API
```python
from huggingface_hub import HfApi, login
from datasets import load_dataset, Dataset

# Login
login(token=HF_TOKEN)

# Create repo
api = HfApi()
api.create_repo("goldfish-inc/repo-name", repo_type="dataset", private=True)

# Upload parquet
dataset = Dataset.from_pandas(df)
dataset.push_to_hub("goldfish-inc/repo-name", private=True)

# Load dataset
dataset = load_dataset("goldfish-inc/repo-name", token=HF_TOKEN)
```

## Cost Estimates

### Claude API (191 documents)
- Average document: ~1000 tokens input
- Entity extraction: ~500 tokens output
- Cost per document: ~$0.015
- **Total: ~$3 for 191 documents**

### Storage
- DeepSeek output: ~6MB (191 parquet files) - on HF ✅
- Preannotated: ~8MB (with entities) - on HF ✅
- Training data: ~10MB (with annotations) - on HF ✅
- **VPS storage: 0 MB** (all on HuggingFace)

## Next Steps

1. Create HF repos via web UI (faster than CLI debugging)
2. Build preannotate_with_claude.py with full entity taxonomy
3. Test on 5 sample documents
4. Run on all 191 documents
5. Build remaining pipeline scripts

## Important Notes

- **NO GPU/Llama setup needed right now** - focus on Claude pipeline first
- **ALL parquet files stored on HuggingFace** - keeps VPS clean
- **PostgreSQL only for final vessel database** - not for training data
- **DO NOT reprocess PDFs** - use existing deepseekocr-output
