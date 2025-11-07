# Oceanid Data Pipeline - Current Status

**Last Updated:** 2025-11-06

## Your Data Flow Understanding ✓ CORRECT

```
CSV → csv/xls worker → Parquet
                         ↓
PDF → deepseekocr → Parquet → HuggingFace Repo
                         ↓
                    DuckDB Load
                         ↓
        ┌────────────────┴────────────────┐
        ↓                                  ↓
   (a) SME Annotation                (b) Direct Load
   (Label Studio)                    (Production Shortcut)
        ↓                                  ↓
   Back to Parquet                   PostgreSQL
        ↓                                  ↓
   ────→ PostgreSQL/EBISU ←───────────────┘
              ↓
        PostGraphile GraphQL API
              ↓
        @ocean/ Platform Components
```

## ✅ READY - Working Now

### 1. Local Development Environment

**Status:** ✅ Complete and tested

```bash
# One command to start everything
make pg.dev.full
```

**What you get:**
- PostgreSQL 17.6 (matches CrunchyBridge) - `localhost:5432`
- PostGraphile GraphQL API - `http://localhost:5000/graphiql`
- PgAdmin web UI - `http://localhost:5050`
- All migrations applied
- EBISU schema ready

**Files:**
- `docker-compose.yml` - Services definition
- `Makefile` - All automation targets
- `QUICKSTART.md` - Complete setup guide

### 2. CSV/XLS Ingestion Worker

**Status:** ✅ Fully implemented (Go)

**Location:** `apps/csv-ingestion-worker/main.go`

**Features:**
- S3 file ingestion
- Database-driven cleaning rules
- Confidence scoring per field
- Label Studio integration
- Prometheus metrics
- Writes to `stage.*` schema

**How to use:**
```bash
cd apps/csv-ingestion-worker
go run . # Requires DATABASE_URL, S3_BUCKET env vars
```

**Database Tables:**
- `control.cleaning_rules` - Cleaning logic
- `stage.documents` - Ingested data
- `stage.extractions` - Cell-level data with confidence

### 3. Schema & Migrations

**Status:** ✅ Complete

**Migrations:** `sql/migrations/V1-V12`
- V1: Staging baseline (control, raw, stage, label, curated)
- V7: Stage contract alignment (worker-safe)
- V8: Curated core entities (ebisu.vessels)
- V11: Temporal assertions
- V12: Stage→Curated promotions

**Key Functions:**
- `ebisu.process_vessel_load()` - Entity resolution
- `public.search_vessels()` - Fuzzy name search
- Views: `ui_vessels`, `ui_vessel_report`, `ui_vessel_conflicts`

### 4. Data Loading Tools

**Status:** ✅ Working

**Python Scripts:**
- `scripts/mvp_build_dataset.py` - CSV → Parquet with entity resolution
- `scripts/load_postgres.py` - Parquet → PostgreSQL via DuckDB

**Make Targets:**
```bash
make parquet              # Build parquet from CSVs
make pg.dev.load          # Load into local Postgres
make cb.stage.load        # Load to CrunchyBridge staging
make cb.ebisu.process     # Run EBISU transform
make cb.ebisu.full        # Full pipeline
```

### 5. PostGraphile API

**Status:** ✅ Running in docker-compose + K8s

**Local:** `http://localhost:5000/graphiql`
**Production:** Via K8s in `apps/postgraphile`

**Schemas exposed:**
- `public` - UI views (ui_vessels, ui_vessel_report)
- `ebisu` - Direct access (if needed)

**Sample Query:**
```graphql
{
  allUiVessels(first: 10) {
    nodes {
      entityId
      vesselName
      imo
      mmsi
      vesselFlag
    }
  }
}
```

## 🚧 PARTIALLY READY - Needs Work

### 6. PDF Ingestion Worker

**Status:** 🚧 Scaffold only

**Location:** `apps/pdf-ingestion-worker/main.go`

**Current State:**
- Minimal Go scaffold
- Heartbeat loop only
- No actual PDF processing

**What's Needed:**
1. PDF download from S3/HTTP
2. Call OCR service (deepseek/docling)
3. Extract structured data
4. Write to `stage.documents`
5. Generate parquet output

**Recommendation:** Implement as Python service using:
- `scripts/batch_extract.py` (already exists!)
- Docling for PDF → Markdown
- Push to HuggingFace Datasets

### 7. OCR Service (DeepSeek/Docling)

**Status:** 🚧 Scaffold only

**Location:** `apps/ocr-service/main.go`

**Current State:**
- Health check endpoints only
- No OCR implementation

**What's Needed:**
1. Add DeepSeek OCR endpoint (`POST /ocr`)
2. Accept PDF bytes or URL
3. Return structured text/tables
4. Optionally: Docling integration for layout preservation

**Alternative:** Use Triton inference directly (already deployed on Calypso GPU)
- `triton-models/docling_granite_python/` exists
- GPU: `https://gpu.boathou.se`
- May not need separate ocr-service

### 8. SME Annotation Flow (Label Studio)

**Status:** 🚧 Partial infrastructure

**What Exists:**
- CSV worker integrates with Label Studio API
- `apps/ls-triton-adapter/` - Connects Label Studio to Triton ML backend
- Database tables for annotations (paused in migrations)

**What's Missing:**
1. Parquet → Label Studio task importer
2. Label Studio → Parquet exporter
3. SME review UI (Label Studio hosted? or custom?)
4. Approval workflow (SME corrections → production)

**Note:** Currently using **Path B (direct load)** for MVP. Path A can be added later.

### 9. HuggingFace Datasets Integration

**Status:** 🚧 Script exists, not automated

**What Exists:**
- `scripts/hf_xet_pdf_uploader.py` - Manual upload to HF

**What's Missing:**
- Automated push after cleaning
- Versioning strategy
- Dataset registry (V10 migration adds `curated.dataset_registry`)

**Recommendation:**
```python
from datasets import Dataset
import pandas as pd

df = pd.read_parquet("data/mvp/vessels_mvp.parquet")
ds = Dataset.from_pandas(df)
ds.push_to_hub("goldfish-inc/vessels-mvp", private=True)
```

## ❌ NOT STARTED

### 10. DuckDB Analytics Layer

**Status:** ❌ Not implemented (but easy to add)

**What's Needed:**
1. DuckDB persistent database
2. Load parquet files for analysis
3. Expose via MotherDuck (optional)

**Current State:**
- DuckDB used as CLI tool for loading only
- No persistent DuckDB database
- MotherDuck target exists in Makefile (`make md.load`)

**Quick Start:**
```bash
# Create persistent DuckDB
duckdb data/vessels.duckdb

# Load parquet
CREATE TABLE vessels AS SELECT * FROM read_parquet('data/mvp/vessels_mvp.parquet');

# Query
SELECT COUNT(*), vessel_flag FROM vessels GROUP BY vessel_flag;
```

## 📋 RECOMMENDED NEXT STEPS

### Phase 1: Complete PDF Pipeline (High Priority)
1. **Implement PDF Ingestion Worker** (Python recommended)
   - Use existing `scripts/batch_extract.py` as base
   - Add S3 download
   - Call Triton Docling endpoint (already on Calypso GPU)
   - Write to `stage.documents`

2. **Test End-to-End PDF Flow**
   - PDF → Triton Docling → Parquet → PostgreSQL
   - Verify data quality

### Phase 2: SME Annotation (Medium Priority)
1. **Parquet ↔ Label Studio Integration**
   - Importer: Parquet → Label Studio tasks
   - Exporter: Annotations → corrected Parquet

2. **Deploy Label Studio**
   - Already have `apps/ls-triton-adapter`
   - Need Label Studio instance (Docker or SaaS)

### Phase 3: Automation (Low Priority)
1. **HuggingFace Auto-Push**
   - After cleaning, push to HF Datasets
   - Version control with dataset_registry

2. **DuckDB Analytics**
   - Persistent DuckDB for exploratory analysis
   - Optional MotherDuck integration

## 🎯 WHAT YOU CAN DO NOW

### Test the Full CSV Pipeline

```bash
# 1. Start local environment
cd /Users/rt/Developer/oceanid
make pg.dev.full

# 2. Build dataset from test CSVs
make parquet

# 3. Load to staging
export CB_HOST=localhost CB_PORT=5432 CB_USER=postgres \
       CB_PASS=postgres CB_DB=vessels
make cb.stage.load

# 4. Run EBISU entity resolution
make cb.ebisu.process

# 5. Query via GraphQL
open http://localhost:5000/graphiql
```

### Connect @ocean/ Platform

```bash
# In @ocean/ directory
cd ../ocean

# Update .env.local
echo "VITE_GRAPHQL_ENDPOINT=http://localhost:5000/graphql" >> .env.local

# Start platform
pnpm run dev

# Build components that query PostGraphile
# Example: Vessel search, dashboard, detail pages
```

### Work on Missing Pieces

**Pick one:**
1. **PDF Pipeline** - High impact, uses existing GPU
2. **SME Annotation** - Enables quality review workflow
3. **DuckDB Analytics** - Quick win for data exploration

## 📊 Pipeline Health Check

```bash
# Check local Postgres
make pg.dev.psql
\l                    # List databases
\dt public.*          # List public tables
\dt ebisu.*           # List ebisu tables
SELECT COUNT(*) FROM ebisu.vessels;

# Check PostGraphile
curl http://localhost:5000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query": "{ __schema { queryType { name } } }"}'

# Check quality
make cb.test.schema  # Runs sql/tests/quality_assertions.sql
```

## 🆘 Common Issues

**Port 5432 in use:**
```bash
brew services stop postgresql@17
# or change docker-compose ports to 5433:5432
```

**Migrations failing:**
```bash
make pg.dev.reset
make pg.dev.migrate
```

**PostGraphile not starting:**
```bash
docker-compose logs postgraphile
docker-compose restart postgraphile
```

## 📚 Documentation

- **QUICKSTART.md** - Local setup (< 5 minutes)
- **DATA_FLOW.md** - Complete architecture with diagrams
- **sql/README.md** - Schema and migration guide
- **sql/SCHEMA_STATUS.md** - Current schema decisions
- **README.md** - Infrastructure overview

## Summary

✅ **You can start building @ocean/ components NOW**
- Local Postgres 17 with full schema ✓
- PostGraphile GraphQL API ✓
- CSV pipeline working ✓
- Sample data loadable ✓

🚧 **PDF pipeline needs completion**
- Worker scaffold exists
- Triton Docling ready on GPU
- Just needs implementation

📋 **SME annotation is optional**
- Can use direct load (Path B) for MVP
- Add Path A later when quality review needed
