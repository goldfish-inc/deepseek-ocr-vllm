# Data Architecture: Staging vs Curated

**Principle:** JSONB snapshots in staging, typed temporal facts in curated.

---

## Core Separation of Concerns

### Staging Schema (`stage.*`)
**Purpose:** Ingestion, heterogeneity, audit snapshots, processing logs
**Pattern:** Rich JSONB snapshots + unstructured data + processing metadata

### Curated Schema (`curated.*`)
**Purpose:** Clean, queryable intelligence for analytics/ML
**Pattern:** Typed temporal rows + foreign keys + provenance links

---

## Why This Separation?

### 1. **Cost & Performance**
- ❌ **Bad:** JSONB snapshots in curated bloat indexes and slow relational queries
- ✅ **Good:** Temporal tables with typed columns + B-tree indices are 10-100x faster

**Example - Query Performance:**
```sql
-- SLOW: JSONB in curated (requires GIN index, slower than B-tree)
SELECT * FROM curated.vessels
WHERE history->'authorizations' @> '[{"status": "ACTIVE"}]';

-- FAST: Typed temporal table with B-tree index
SELECT * FROM curated.vessel_authorizations
WHERE status = 'ACTIVE' AND valid_to IS NULL;
```

### 2. **Reproducibility & Audit Trail**
- **Staging** carries promotion snapshots for rollback and audit
- **Curated** keeps provenance pointers (source_document_id, content_sha)
- Reproduce any curated fact by joining back to `stage.documents`

### 3. **Schema Evolution**
- **Staging** JSONB accommodates heterogeneous sources without schema changes
- **Curated** typed columns enable database-level constraints and validation

---

## JSONB Usage Guidelines

### ✅ Staging Schema - Where JSONB Belongs

#### 1. Raw Document Storage
```sql
-- stage.documents: Original content + metadata
CREATE TABLE stage.documents (
  id bigserial PRIMARY KEY,
  content text,                    -- Raw text or base64-encoded binary
  content_sha text,                -- SHA-256 hash for deduplication
  metadata jsonb,                  -- ✅ Source-specific metadata (flexible)
  url text,
  fetched_at timestamptz
);

-- Example metadata JSONB:
{
  "source": "SEAFO",
  "document_type": "vessel_registry",
  "publication_date": "2025-08-26",
  "format": "CSV",
  "columns": ["VESSEL_NAME", "IMO", "FLAG", "GEAR_TYPE"],
  "encoding": "UTF-8"
}
```

#### 2. Processing Logs & Metrics
```sql
-- stage.document_processing_log: Processing metadata
CREATE TABLE stage.document_processing_log (
  id bigserial PRIMARY KEY,
  document_id bigint REFERENCES stage.documents(id),
  from_state text,
  to_state text,
  metrics jsonb,                   -- ✅ Processing metrics (variable per processor)
  error_details jsonb,             -- ✅ Error context for debugging
  processor_version text,
  triggered_at timestamptz
);

-- Example metrics JSONB:
{
  "rows_processed": 1234,
  "cells_cleaned": 5678,
  "confidence_avg": 0.92,
  "rules_applied": [12, 34, 56, 78],
  "processing_time_ms": 4567,
  "memory_peak_mb": 128
}

-- Example error_details JSONB:
{
  "error_type": "ValidationError",
  "error_message": "IMO check digit failed",
  "failed_rows": [45, 67, 89],
  "context": {"row": 45, "column": "IMO", "value": "1234567"}
}
```

#### 3. Promotion Snapshots (Rollback Support)
```sql
-- stage.promotion_log: Before/after snapshots for rollback
CREATE TABLE stage.promotion_log (
  id bigserial PRIMARY KEY,
  document_id bigint REFERENCES stage.documents(id),
  promoted_at timestamptz,
  target_table text,
  target_ids jsonb,                -- ✅ Map of promoted record IDs
  before_snapshot jsonb,           -- ✅ State before promotion (rollback capability)
  after_snapshot jsonb,            -- ✅ State after promotion (audit trail)
  quality_checks_passed jsonb      -- ✅ Quality gate results
);

-- Example before_snapshot JSONB (rollback data):
{
  "curated.vessels": [
    {"vessel_id": 123, "imo": "9074729", "name": "OLD NAME", "updated_at": "2025-09-29"}
  ]
}

-- Example after_snapshot JSONB (audit trail):
{
  "curated.vessels": [
    {"vessel_id": 123, "imo": "9074729", "name": "FU RONG YU 6668", "updated_at": "2025-09-30"}
  ],
  "curated.vessel_authorizations": [
    {"id": "uuid-123", "vessel_id": 123, "rfmo_id": "uuid-rfmo-1", "status": "ACTIVE"}
  ]
}
```

#### 4. Training Corpus Context
```sql
-- stage.training_corpus: ML training examples with context
CREATE TABLE stage.training_corpus (
  id bigserial PRIMARY KEY,
  extraction_id bigint REFERENCES stage.csv_extractions(id),
  original_value text,
  corrected_value text,
  context_before text,
  context_after text,
  annotation_source text,
  annotator text
);

-- Use case: Context needed for context-aware NER/entity resolution
-- No JSONB needed here - structured fields sufficient
```

#### 5. Rule Chains & Cleaning History
```sql
-- stage.csv_extractions: Cell-level cleaning with rule provenance
CREATE TABLE stage.csv_extractions (
  id bigserial PRIMARY KEY,
  document_id bigint REFERENCES stage.documents(id),
  row_index int,
  column_name text,
  raw_value text,
  cleaned_value text,
  rule_chain jsonb,                -- ✅ Ordered list of rule IDs applied
  confidence double precision,
  needs_review boolean
);

-- Example rule_chain JSONB:
[12, 34, 56]  -- Applied cleaning_rules.id in this order
```

---

### ✅ Curated Schema - Typed Temporal Facts Only

#### 1. Temporal Tables (No JSONB)
```sql
-- curated.vessel_authorizations: Typed temporal facts
CREATE TABLE curated.vessel_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id bigint REFERENCES curated.vessels(vessel_id),
  rfmo_id uuid REFERENCES curated.rfmos(id),
  authorization_type text REFERENCES curated.authorization_types(code),
  authorization_number text,

  -- Temporal validity
  valid_from date NOT NULL,
  valid_to date,

  -- Scope (typed arrays, not JSONB)
  authorized_gear_types text[],   -- ✅ Typed array, FK-validatable
  authorized_species text[],      -- ✅ Typed array, FK-validatable
  authorized_areas text[],        -- ✅ Typed array, FK-validatable
  catch_limits jsonb,             -- ⚠️ EXCEPTION: Complex nested structure

  -- Provenance (pointers, not snapshots)
  source_document_id bigint REFERENCES stage.documents(id),
  confidence double precision,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- catch_limits JSONB is acceptable because:
-- 1. Small size (2-4 KB per authorization)
-- 2. Complex nested structure (species → limit → period → area)
-- 3. Rare queries on limit specifics (mostly just "has active auth?")
-- Example: {"TOT": {"limit_mt": 500, "period": "annual", "area": "48.3"}}
```

#### 2. Provenance Links (FKs, Not Snapshots)
```sql
-- curated.vessel_sanctions: Provenance via FK + hash
CREATE TABLE curated.vessel_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id bigint REFERENCES curated.vessels(vessel_id),
  sanction_type text REFERENCES curated.sanction_types(code),

  imposed_date date NOT NULL,
  lifted_date date,

  violation_type text,
  violation_description text,    -- ✅ Typed field, not JSONB
  violation_location geometry(Point, 4326),  -- ✅ Typed PostGIS, not JSONB coordinates

  -- Provenance (pointer to source, not snapshot)
  source_document_id bigint REFERENCES stage.documents(id),  -- ✅ Join to stage for full context
  source_url text,
  confidence double precision
);

-- To get full source context:
SELECT s.*, d.content, d.metadata
FROM curated.vessel_sanctions s
JOIN stage.documents d ON s.source_document_id = d.id
WHERE s.vessel_id = 123;
```

#### 3. Current State Views (Instead of JSONB Snapshots)
```sql
-- curated.v_vessels_current_state: Materialized current state
CREATE VIEW curated.v_vessels_current_state AS
SELECT
  v.vessel_id,
  v.imo,
  v.name AS vessel_name,

  -- Current flag (from temporal table)
  fh.flag_country_id AS current_flag_id,
  c.alpha2 AS current_flag_alpha2,
  fh.valid_from AS flag_since,

  -- Active authorizations (aggregated, not snapshot)
  (SELECT COUNT(*) FROM curated.vessel_authorizations va
   WHERE va.vessel_id = v.vessel_id AND va.status = 'ACTIVE') AS active_authorizations,

  -- Active sanctions (aggregated, not snapshot)
  (SELECT COUNT(*) FROM curated.vessel_sanctions vs
   WHERE vs.vessel_id = v.vessel_id AND vs.lifted_date IS NULL) AS active_sanctions,

  -- Typed fields from vessel_info (not JSONB)
  vi.vessel_type,
  vi.build_year,
  vi.risk_level,
  vi.risk_score

FROM curated.vessels v
LEFT JOIN curated.vessel_flag_history fh ON v.vessel_id = fh.vessel_id AND fh.valid_to IS NULL
LEFT JOIN curated.country_iso c ON fh.flag_country_id = c.id
LEFT JOIN curated.vessel_info vi ON v.vessel_id = vi.vessel_id;

-- Fast queries with B-tree indices, no GIN/GiST on JSONB
SELECT * FROM curated.v_vessels_current_state
WHERE current_flag_alpha2 = 'CN' AND risk_level IN ('HIGH', 'CRITICAL');
```

---

## Acceptable JSONB Exceptions in Curated

### 1. Small Evidence Fields (2-4 KB)
**Use case:** UI tooltips showing inline excerpts without joining to stage

```sql
-- curated.entity_confirmations: Small evidence snippet for UI
CREATE TABLE curated.entity_confirmations (
  id uuid PRIMARY KEY,
  entity_type text,
  entity_id bigint,
  confirmed_field text,
  confirmed_value text,

  -- ⚠️ Small evidence JSONB for UI (optional)
  evidence jsonb,                  -- Max 4 KB: {"excerpt": "...", "page": 3, "confidence": 0.95}

  -- ✅ Full source via FK
  confirming_document_id bigint REFERENCES stage.documents(id),
  confirmed_at timestamptz
);
```

### 2. Genuinely Rare/Unstable Attributes
**Use case:** Attributes that don't justify typed columns yet

```sql
-- curated.vessel_info: Hybrid typed + EAV
CREATE TABLE curated.vessel_info (
  vessel_id bigint PRIMARY KEY REFERENCES curated.vessels(vessel_id),

  -- ✅ Typed columns for frequent queries
  vessel_type text,
  build_year int,
  risk_level text,
  risk_score numeric(5,2),

  -- ✅ EAV for rare/unstable attributes (NOT JSONB snapshots)
  key text,
  value text
);

-- Promote to typed column once attribute becomes frequent:
-- 1. Add column: ALTER TABLE curated.vessel_info ADD COLUMN new_field text;
-- 2. Migrate data: UPDATE curated.vessel_info SET new_field = value WHERE key = 'attribute_name';
-- 3. Drop EAV rows: DELETE FROM curated.vessel_info WHERE key = 'attribute_name';
```

### 3. Complex Nested Structures (Rare)
**Use case:** Catch limits with species → limit → period → area hierarchy

```sql
-- curated.vessel_authorizations.catch_limits JSONB
{
  "TOT": {                         -- ASFIS species code
    "limit_mt": 500,               -- Catch limit in metric tons
    "period": "annual",            -- Limitation period
    "area": "48.3"                 -- FAO subarea
  },
  "TOP": {
    "limit_mt": 300,
    "period": "quarterly",
    "area": "48.4"
  }
}

-- Rarely queried on specifics (mostly "has active auth?")
-- Would require 3-4 normalized tables if fully typed
```

---

## Anti-Patterns to Avoid

### ❌ JSONB History Snapshots in Curated
```sql
-- BAD: History snapshots in curated
CREATE TABLE curated.vessels (
  vessel_id bigserial PRIMARY KEY,
  imo text,
  name text,
  flag text,
  history jsonb  -- ❌ DON'T: Bloats indexes, slow queries, no constraints
);

-- BAD: Full document snapshots in curated
INSERT INTO curated.vessels (vessel_id, history) VALUES (
  123,
  '{"authorizations": [...], "sanctions": [...], "ownership": [...]}'  -- ❌ 100+ KB JSONB
);
```

**Why bad:**
- Index bloat: GIN indices on large JSONB are 10x slower than B-tree on typed columns
- No FK constraints: Can't validate RFMO codes, flag states, etc.
- Schema drift: JSONB structure changes invisibly
- Query complexity: JSONB path queries are harder to optimize

**Fix:** Use temporal tables instead:
```sql
-- GOOD: Temporal tables with typed columns
CREATE TABLE curated.vessel_authorizations (...);
CREATE TABLE curated.vessel_sanctions (...);
CREATE TABLE curated.vessel_associates (...);

-- Query current state efficiently
SELECT * FROM curated.v_vessels_current_state WHERE vessel_id = 123;

-- Query history efficiently
SELECT * FROM curated.vessel_flag_history WHERE vessel_id = 123 ORDER BY valid_from DESC;
```

---

### ❌ Duplicating Promotion Snapshots in Curated
```sql
-- BAD: Duplicating promotion snapshots
CREATE TABLE curated.vessels (
  vessel_id bigserial PRIMARY KEY,
  promotion_history jsonb  -- ❌ DON'T: Duplicates stage.promotion_log
);
```

**Why bad:**
- Data duplication: Same snapshots in stage AND curated
- Sync issues: Promotion snapshots belong in audit trail, not operational tables
- Storage waste: Curated should be lean for fast analytics

**Fix:** Keep snapshots in stage only:
```sql
-- GOOD: Snapshots in staging
CREATE TABLE stage.promotion_log (
  before_snapshot jsonb,  -- ✅ Rollback capability
  after_snapshot jsonb    -- ✅ Audit trail
);

-- GOOD: Provenance pointers in curated
CREATE TABLE curated.vessels (
  vessel_id bigserial PRIMARY KEY,
  source_document_id bigint REFERENCES stage.documents(id),  -- ✅ Pointer to source
  updated_at timestamptz  -- ✅ Temporal validity marker
);
```

---

## Data Retention Plan

### Staging Schema (Hot: 12-24 months, then archive)
```sql
-- stage.documents: Archive old documents to object storage
-- Keep content_sha constant for deduplication/lineage
-- Archive after 12-24 months to S3/GCS with lifecycle policy

-- Retention policy example:
-- 1. Month 0-12: Hot (PostgreSQL)
-- 2. Month 12-24: Warm (compressed in PostgreSQL or object storage)
-- 3. Month 24+: Cold (object storage with Glacier/Coldline)

-- Lineage preserved via content_sha:
-- curated.vessels.source_document_id → stage.documents.id → object_storage_url
```

### Curated Schema (Indefinite)
```sql
-- curated.vessel_authorizations: Keep temporal facts indefinitely
-- No JSONB snapshots → minimal storage growth
-- Temporal tables enable time-travel queries without snapshots

-- Query historical state:
SELECT * FROM curated.vessel_authorizations
WHERE vessel_id = 123
  AND valid_from <= '2023-06-15'
  AND (valid_to IS NULL OR valid_to >= '2023-06-15');
```

### Optional: Append-Only Audit (Regulatory Compliance)
```sql
-- audit.change_log: CDC-style append-only log (if required)
CREATE TABLE audit.change_log (
  id bigserial PRIMARY KEY,
  table_name text,
  record_id text,
  operation text,  -- INSERT | UPDATE | DELETE
  old_values jsonb,
  new_values jsonb,
  changed_by text,
  changed_at timestamptz DEFAULT now()
);

-- Populated via triggers or CDC tools (Debezium, pglogical)
-- Separate from curated schema → no operational impact
```

---

## Practical Next Steps

### 1. Continue Using stage.promotion_log for Snapshots
✅ Already implemented in V3 migration:
```sql
-- sql/migrations/V3__staging_tables_complete.sql:240
CREATE TABLE stage.promotion_log (
  before_snapshot jsonb,  -- ✅ Rollback data
  after_snapshot jsonb,   -- ✅ Audit trail
  target_ids jsonb        -- ✅ Map of promoted record IDs
);
```

**Don't duplicate these in curated.**

### 2. Ensure Provenance in Every Curated Row
✅ Already implemented in V5 migration:
```sql
-- sql/migrations/V5__curated_temporal_events.sql
CREATE TABLE curated.vessel_authorizations (
  source_document_id bigint REFERENCES stage.documents(id),  -- ✅ Lineage pointer
  confidence double precision                                 -- ✅ Quality metric
);
```

**Always include:**
- `source_document_id`: FK to stage.documents
- `content_sha`: Deduplication + immutable lineage
- `confidence`: ML model confidence score

### 3. Avoid Adding JSONB Columns to curated.*
**Exception:** Small evidence fields (<4 KB) for UI tooltips

**Instead of JSONB:**
- Add typed column if field becomes frequent
- Create related table for complex relationships
- Keep ad-hoc metadata in `vessel_info` EAV pattern (key/value, not JSONB)

### 4. Historic Replay via CDC (If Needed)
**Don't embed history JSON in curated.**

**Options:**
- CDC to external audit store (Kafka, S3, Elasticsearch)
- Use temporal tables + time-travel queries
- Join back to `stage.promotion_log` for promotion history

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ STAGING SCHEMA (stage.*)                                        │
│ Purpose: Ingestion, audit, processing logs                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  stage.documents                                                │
│  ├─ content text (raw/base64)                                   │
│  ├─ content_sha text (deduplication)                            │
│  └─ metadata jsonb ✅ (source-specific, flexible)              │
│                                                                  │
│  stage.document_processing_log                                  │
│  ├─ metrics jsonb ✅ (variable per processor)                  │
│  └─ error_details jsonb ✅ (debugging context)                 │
│                                                                  │
│  stage.promotion_log                                            │
│  ├─ before_snapshot jsonb ✅ (rollback capability)             │
│  ├─ after_snapshot jsonb ✅ (audit trail)                      │
│  └─ target_ids jsonb ✅ (promoted record map)                  │
│                                                                  │
│  stage.csv_extractions                                          │
│  └─ rule_chain jsonb ✅ (cleaning provenance)                  │
│                                                                  │
│  Retention: 12-24 months hot → archive to object storage        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    Promote (with snapshots)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ CURATED SCHEMA (curated.*)                                      │
│ Purpose: Clean, queryable intelligence                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  curated.vessels                                                │
│  ├─ vessel_id bigint PK                                         │
│  ├─ imo text ✅                                                 │
│  ├─ name text ✅                                                │
│  ├─ source_document_id FK → stage.documents ✅                  │
│  └─ NO JSONB history ❌                                         │
│                                                                  │
│  curated.vessel_flag_history (temporal)                         │
│  ├─ vessel_id FK                                                │
│  ├─ flag_country_id FK → country_iso ✅                         │
│  ├─ valid_from date ✅                                          │
│  ├─ valid_to date ✅                                            │
│  └─ source_document_id FK → stage.documents ✅                  │
│                                                                  │
│  curated.vessel_authorizations (temporal)                       │
│  ├─ vessel_id FK                                                │
│  ├─ rfmo_id FK → rfmos ✅                                       │
│  ├─ authorized_gear_types text[] ✅ (typed array, not JSONB)   │
│  ├─ catch_limits jsonb ⚠️ (exception: complex nested)          │
│  ├─ valid_from/valid_to ✅                                      │
│  └─ source_document_id FK ✅                                    │
│                                                                  │
│  curated.v_vessels_current_state (view)                         │
│  └─ Aggregates temporal tables → fast B-tree queries ✅        │
│                                                                  │
│  Retention: Indefinite (typed facts only, minimal growth)       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary

**✅ DO:**
- JSONB in staging: metadata, processing logs, promotion snapshots, error details, rule chains
- Typed columns in curated: vessel_type, build_year, risk_level, authorized_gear_types[]
- Temporal tables in curated: valid_from/valid_to for time-series queries
- Provenance via FK: source_document_id → stage.documents
- Views for current state: v_vessels_current_state (no JSONB snapshots)

**❌ DON'T:**
- JSONB history snapshots in curated (use temporal tables)
- Duplicate promotion snapshots in curated (keep in stage.promotion_log)
- Large JSONB columns in curated (>4 KB bloats indices)
- JSONB instead of FK constraints (prefer country_iso.id over {"flag": "CN"})

**This architecture already matches your V3-V6 migrations! JSONB snapshots are correctly placed in stage.promotion_log, while curated uses normalized temporal tables with FK provenance.**