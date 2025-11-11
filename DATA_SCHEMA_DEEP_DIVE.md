# Data Schema Deep Dive - MVP vs HF OCR vs EBISU Schema

**Date:** 2025-01-06
**Analysis:** Complete comparison of data sources and schema coverage

---

## Executive Summary

### Data Sources Overview

| Source | Type | Record Count | Use Case | Status |
|--------|------|--------------|----------|--------|
| **MVP Parquet** | Authorized vessels | 36,122 raw / 7,666 canonical | Legal vessel tracking | ✅ Loaded & resolved |
| **HF OCR** | IUU watchlists | 191 pages / 36 PDFs | Sanctions & compliance | 🔄 Needs NER extraction |
| **EBISU Schema** | Database tables | N/A | Complete intelligence | ✅ Ready (but empty) |

### Critical Finding

**🔴 MAJOR GAP**: HF OCR contains **IUU-specific fields** not in MVP parquet:
- IUU listing dates
- Violation descriptions
- Sanctioning authorities
- Previous owners/names/flags
- Actions taken / Outcomes

These fields exist in **EBISU schema** but are NOT populated yet.

---

## 1. MVP Parquet Schema (Authorized Vessels)

**Source:** `data/mvp/vessels_mvp.parquet`
**Total Columns:** 313
**RFMOs:** 11 (ICCAT, IOTC, IATTC, WCPFC, SPRFMO, etc.)

### Key Field Categories

#### Core Identifiers (✅ Well Covered)
```
- ENTITY_ID (source-specific)
- IMO
- MMSI
- IRCS (call sign)
- VESSEL_NAME
- VESSEL_FLAG
- RFMO (source attribution)
```

#### Authorization Fields (✅ Present)
```
- AUTHORISATION_START_DATE
- AUTHORISATION_END_DATE
- AUTHORISED (boolean)
- APPLICATION_TYPE
- ANY_SPECIFIC_AREAS_IN_WHICH_AUTHORIZED_TO_FISH
- ANY_SPECIFIC_SPECIES_FOR_WHICH_AUTHORIZED_TO_FISH
```

#### Owner/Operator Fields (🟡 Partially Populated)
```
- ADDRESS_OF_THE_OWNER_OR_OWNERS
- ADDRESS_OF_CHARTERER
- NAME_OF_CHARTERER
- NAME_OF_THE_OWNER_OR_OWNERS
- VESSEL_MASTER_NAME
- VESSEL_MASTER_NATIONALITY
```

**Issue:** Only 17% populated in raw data.

#### Vessel Characteristics (✅ Well Covered)
```
- VESSEL_TYPE
- VESSEL_LENGTH_LOA
- VESSEL_LENGTH_PP
- VESSEL_TONNAGE_GRT
- ENGINE_POWER
- YEAR_BUILT / WHEN_BUILT
- WHERE_BUILT
- HULL_MATERIAL
```

#### Gear & Equipment (✅ Present)
```
- GEAR_TYPE
- FISHING_GEAR
- VMS_COMM_SYSTEM (VMS tracking)
- SATELLITE_TRACKING
```

#### RFMO-Specific IDs (✅ Excellent)
```
- WCPFC_ID
- IATTC_ID
- IOTC_ID
- ICCAT_ID
- FFA_VID
- PNA_VID
```

### ❌ What's MISSING from MVP Parquet

**IUU & Sanctions:**
- No IUU listing status
- No violation records
- No sanctions data
- No watchlist membership

**Temporal Intelligence:**
- No previous names
- No previous flags
- No ownership change dates
- No historical timeline

**Enforcement:**
- No port inspection records
- No detention history
- No penalties/fines

---

## 2. HF OCR Schema (IUU Watchlists)

**Source:** `goldfish-inc/deepseekocr-output`
**Total Pages:** 191
**PDFs:** 36 IUU lists from multiple RFMOs

### Data Structure

```json
{
  "pdf_name": "WCPFC_IUU_list_for_2025-02-01",
  "page_number": 1,
  "clean_text": "<table><tr><td>Current name of vessel...</td></tr></table>",
  "metadata": {
    "has_tables": true,
    "source": "WCPFC",
    "page_number": 1
  }
}
```

### Extracted Table Fields (from OCR)

**Core IUU Fields:**
```
- Current name of vessel (and any previous names)
- Current flag (previous flags)
- Date first included on WCPFC IUU Vessel List
- Flag State Registration Number / IMO Number
- Call Sign (previous call signs)
- Vessel Master (nationality)
- Owner/beneficial owners (previous owners)
- Notifying CCM
- IUU activities
```

**SPRFMO-Specific Fields:**
```
- Vessel Name
- Previous Name(s)
- Current Owner Name & Address
- Prior Owner
- Current Operator
- Prior Operator
- Image (vessel photo URL)
- Date the vessel was first included in the IUU List
- Position (GPS coordinates)
- Summary of Activities
- Actions taken
- Outcome
```

**IOTC-Specific Fields:**
```
- IOTC IUU No. (unique identifier)
- Effective From (date)
- History (narrative)
```

### 🔴 Critical NEW Fields Not in MVP

1. **Previous Names** - Name change tracking
2. **Previous Flags** - Flag hopping detection
3. **Previous Owners** - Ownership shell games
4. **IUU Activities** - Violation descriptions
5. **Actions Taken** - Enforcement outcomes
6. **Summary of Activities** - Intelligence narrative
7. **Notifying CCM** - Which country reported it
8. **Date first included** - IUU listing timestamp

---

## 3. EBISU Schema Support

**Location:** `sql/oceanid-ebisu-schema/migrations/`

### ✅ Schema ALREADY SUPPORTS These (but empty!)

#### `vessels_iuu_simple` (Migration 0006)
```sql
CREATE TABLE vessels_iuu_simple (
    iuu_uuid UUID PRIMARY KEY,
    vessel_uuid UUID REFERENCES vessels(vessel_uuid),
    source_id UUID REFERENCES original_sources_vessels(source_id),

    is_iuu BOOLEAN DEFAULT false,
    listed_iuu JSONB,  -- Array of RFMO UUIDs
    activity_iuu VARCHAR(500),  -- ✅ IUU activities field

    created_at TIMESTAMP
);
```

**Status:** ✅ Table exists, ❌ Empty

#### `vessel_source_identifiers` (Migration 0005)
```sql
CREATE TABLE vessel_source_identifiers (
    identifier_uuid UUID PRIMARY KEY,
    vessel_uuid UUID REFERENCES vessels(vessel_uuid),
    source_id UUID REFERENCES original_sources_vessels(source_id),
    identifier_type identifier_type_enum,  -- name, imo, mmsi, ircs
    identifier_value TEXT,
    associated_flag UUID REFERENCES country_iso(id),
    created_at TIMESTAMP
);
```

**Purpose:** Can store **previous names, previous flags, previous call signs**
**Status:** ✅ Table exists, 🟡 Partially populated (current identifiers only)

#### `vessel_associates` (Migration 0005)
```sql
CREATE TABLE vessel_associates (
    associate_uuid UUID PRIMARY KEY,
    vessel_uuid UUID REFERENCES vessels(vessel_uuid),
    associate_type associate_type_enum,  -- OWNER, OPERATOR, BENEFICIAL_OWNER, etc.
    entity_type TEXT CHECK (entity_type IN ('PERSON', 'ORGANIZATION')),
    entity_id UUID,  -- FK to entity_organizations or entity_persons
    valid_from DATE,
    valid_to DATE,
    created_at TIMESTAMP
);
```

**Purpose:** Can store **ownership history with temporal tracking**
**Status:** ✅ Table exists, ❌ Empty

#### `vessel_reported_history` (Migration 0005)
```sql
CREATE TABLE vessel_reported_history (
    history_uuid UUID PRIMARY KEY,
    vessel_uuid UUID REFERENCES vessels(vessel_uuid),
    source_id UUID REFERENCES original_sources_vessels(source_id),
    change_type reported_history_enum,  -- NAME_CHANGE, FLAG_CHANGE, OWNERSHIP_CHANGE
    change_date DATE,
    old_value TEXT,
    new_value TEXT,
    notes TEXT,
    created_at TIMESTAMP
);
```

**Purpose:** **Temporal intelligence** - name changes, flag changes, ownership transfers
**Status:** ✅ Table exists, ❌ Empty

#### `vessels_outlaw_ocean` (Migration 0006)
```sql
CREATE TABLE vessels_outlaw_ocean (
    outlaw_ocean_uuid UUID PRIMARY KEY,
    vessel_uuid UUID REFERENCES vessels(vessel_uuid),
    source_id UUID REFERENCES original_sources_vessels(source_id),

    mandarin_name VARCHAR(40),
    subsidy_recipient BOOLEAN,
    state_owned_operator BOOLEAN,
    crimes JSONB,  -- Array of crime_type_enum
    concerns VARCHAR(300),
    oo_url TEXT,

    created_at TIMESTAMP
);
```

**Purpose:** Outlaw Ocean-specific intelligence
**Status:** ✅ Table exists, ❌ Empty

---

## 4. Critical Gaps & Recommendations

### Gap 1: IUU Watchlist Data Not Extracted

**Problem:** HF OCR contains 191 pages of IUU data as RAW TEXT, not structured entities.

**Solution:**
1. Build NER (Named Entity Recognition) pipeline to extract:
   - Vessel names
   - IMO numbers
   - Previous names/flags
   - IUU activities
   - Listing dates
2. Populate `vessels_iuu_simple` table
3. Link to existing `vessels` via IMO matching

**Priority:** 🔴 P0 - Critical for compliance features

---

### Gap 2: Temporal Tracking Not Populated

**Problem:** Schema supports `vessel_reported_history`, but no data loaded.

**Solution:**
1. Extract "Previous Names" from HF OCR → insert as NAME_CHANGE
2. Extract "Previous Flags" from HF OCR → insert as FLAG_CHANGE
3. Extract "Previous Owners" from HF OCR → insert as OWNERSHIP_CHANGE
4. Populate `vessel_source_identifiers` with historical identifiers

**Priority:** 🔴 P0 - Essential for intelligence

---

### Gap 3: Ownership Data Sparse

**Problem:** MVP parquet only 17% populated for owner fields.

**Solution:**
1. Extract "Owner/beneficial owners (previous owners)" from HF OCR
2. Create `entity_organizations` records for companies
3. Link via `vessel_associates` table with temporal ranges
4. Flag shell companies (tax havens, BVI, Panama)

**Priority:** 🟡 P1 - High value for intelligence

---

### Gap 4: Enforcement Actions Missing

**Problem:** No table for "Actions taken" or "Outcome" from IUU lists.

**Solution:**
Create new table:
```sql
CREATE TABLE vessel_enforcement_actions (
    action_uuid UUID PRIMARY KEY,
    vessel_uuid UUID REFERENCES vessels(vessel_uuid),
    source_id UUID REFERENCES original_sources_vessels(source_id),

    action_type TEXT,  -- 'PORT_BAN', 'FINE', 'LICENSE_REVOCATION', etc.
    action_date DATE,
    sanctioning_authority TEXT,  -- 'WCPFC', 'EU', 'NPFC'
    description TEXT,
    outcome TEXT,
    amount_fined DECIMAL,

    created_at TIMESTAMP
);
```

**Priority:** 🟡 P1 - Valuable for risk scoring

---

### Gap 5: Document Lineage Not Tracked

**Problem:** Can't trace which PDF page a data point came from.

**Solution:**
1. Add `source_document_url` to `original_sources_vessels`
2. Add `source_page_number` to all entity tables
3. Store HF parquet metadata in JSONB field

**Priority:** 🟢 P2 - Nice to have for auditing

---

## 5. Schema Enhancement Proposals

### Proposal A: IUU Violation Details Table

```sql
CREATE TABLE vessel_iuu_violations (
    violation_uuid UUID PRIMARY KEY,
    vessel_uuid UUID REFERENCES vessels(vessel_uuid),
    source_id UUID REFERENCES original_sources_vessels(source_id),

    violation_type TEXT,  -- 'ILLEGAL_FISHING', 'TRANSSHIPMENT', 'QUOTA_VIOLATION'
    violation_date DATE,
    listing_date DATE,
    removal_date DATE,  -- NULL if still listed
    rfmo_id UUID REFERENCES rfmos(id),
    description TEXT,
    status TEXT CHECK (status IN ('ACTIVE', 'RESOLVED', 'APPEALED')),

    created_at TIMESTAMP
);
```

### Proposal B: Enhanced Identifier History

```sql
-- Add temporal fields to vessel_source_identifiers
ALTER TABLE vessel_source_identifiers
ADD COLUMN valid_from DATE,
ADD COLUMN valid_to DATE,
ADD COLUMN is_current BOOLEAN DEFAULT true;
```

### Proposal C: Risk Scoring Table

```sql
CREATE TABLE vessel_risk_scores (
    risk_uuid UUID PRIMARY KEY,
    vessel_uuid UUID REFERENCES vessels(vessel_uuid),

    overall_score DECIMAL(5,2),  -- 0-100
    identity_score DECIMAL(5,2),
    compliance_score DECIMAL(5,2),
    ownership_score DECIMAL(5,2),
    behavior_score DECIMAL(5,2),

    risk_factors JSONB,
    calculated_at TIMESTAMP,
    valid_until TIMESTAMP
);
```

---

## 6. Data Pipeline Requirements

### Phase 1: IUU Entity Extraction (Immediate)

**Input:** HF OCR parquet files
**Output:** Populated `vessels_iuu_simple` table

**Steps:**
1. Parse `<table>` tags from `clean_text`
2. Extract vessel identifiers (IMO, name, call sign)
3. Match to existing `vessels` by IMO (create if not exists)
4. Extract IUU activities, dates, RFMOs
5. Insert into `vessels_iuu_simple`

**Tools:** Python + Beautiful Soup + DuckDB

---

### Phase 2: Temporal Intelligence (High Priority)

**Input:** HF OCR "Previous Names/Flags/Owners" fields
**Output:** Populated `vessel_reported_history` table

**Steps:**
1. Parse "(previous X)" parenthetical text
2. Infer change dates from "Date first included" or other dates
3. Create history records with old_value/new_value
4. Link to `vessel_source_identifiers` for historical identifiers

---

### Phase 3: Ownership Extraction (Medium Priority)

**Input:** HF OCR "Owner/beneficial owners" fields
**Output:** Populated `vessel_associates` + `entity_organizations`

**Steps:**
1. Extract company names and addresses
2. Create `entity_organizations` records
3. Link via `vessel_associates` with temporal ranges
4. Flag shell companies (pattern: "Ltd, BVI", "Inc, Panama")

---

## 7. Worker Compatibility Analysis

### CSV Ingestion Worker (`apps/csv-ingestion-worker/`)

**Current Behavior:**
- Processes CSVs → `stage.csv_extractions`
- Applies cleaning rules
- Calculates confidence scores
- **Does NOT** populate `curated.vessels` directly

**Needs Update:** ❌ YES

**Required Changes:**
1. Add mapping from `stage.csv_extractions` → `vessels` table
2. Add mapping to `vessel_source_identifiers` for historical identifiers
3. Add mapping to `vessels_iuu_simple` for IUU flags
4. Add mapping to `vessel_reported_history` for temporal changes

**New Fields to Extract:**
```go
type IUUExtraction struct {
    VesselIMO        string
    IsIUU            bool
    ListedRFMOs      []string
    ActivityIUU      string
    ListingDate      time.Time
    PreviousNames    []string
    PreviousFlags    []string
    PreviousOwners   []string
}
```

---

## 8. Recommendations Summary

### Immediate Actions (P0)

1. **Build NER pipeline** for HF OCR → structured IUU data
2. **Populate `vessels_iuu_simple`** with watchlist data
3. **Populate `vessel_reported_history`** with temporal changes
4. **Update CSV worker** to support IUU fields

### High Priority (P1)

5. **Extract ownership** from HF OCR → `vessel_associates`
6. **Create enforcement actions table** for outcomes
7. **Build risk scoring engine** using aggregated data

### Medium Priority (P2)

8. **Add document lineage** tracking (source PDF page)
9. **Implement watchlist matching** API endpoint
10. **Build temporal query** interface (vessel state at date X)

---

## 9. Next Steps

**For Data Team:**
1. Review this analysis
2. Prioritize which gaps to fill first
3. Build NER extraction pipeline
4. Update workers to support new fields

**For UI Team:**
1. Wait for IUU data extraction (Phase 2)
2. Continue building with current authorized vessel data
3. Design UI for upcoming watchlist features

---

**Bottom Line:**
EBISU schema is **intelligence-ready**, but **data is missing**. HF OCR contains the data, but needs extraction pipeline.
