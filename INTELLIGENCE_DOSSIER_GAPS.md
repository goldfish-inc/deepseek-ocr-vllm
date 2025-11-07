# Intelligence Dossier - What's Missing for True Vessel Intelligence

**Date:** 2025-11-06
**Current State:** Basic source tracking + conflict detection implemented
**Status:** Phase 1 complete, Phases 2-5 needed

## What We Have NOW ✅

### 1. Source Provenance Tracking
```json
{
  "vessel_id": 11573,
  "imo": "8347301",
  "identifiers": [
    {
      "type": "NAME",
      "value": "Ryosei Maru No. 26",
      "source_rfmo": "NPFC",
      "confidence": 0.7
    },
    {
      "type": "MMSI",
      "value": "431800172",
      "source_rfmo": "NPFC",
      "confidence": 0.3,
      "collision_detected": true
    }
  ]
}
```

### 2. Conflict Detection (RED FLAGS)
- **9 MMSI collisions detected** - Same MMSI claimed by multiple IMOs
- **Tracked in `entity_conflicts` table** with resolution workflow
- **Low confidence scoring** for conflicting data

### 3. Multi-Source Attribution
- **18,086 identifier records** from multiple RFMOs
- **Tracks which organization reported what**
- **Temporal tracking** via `recorded_at`, `valid_from`, `valid_to`

## What's MISSING for True Intelligence 🚨

### Phase 2: Temporal Intelligence (CRITICAL)

**Problem:** We track WHEN data was recorded, but not WHAT CHANGED

**Missing:**
1. **Historical Timeline**
   ```sql
   -- Need: vessel_history table
   CREATE TABLE curated.vessel_history (
     id bigint PRIMARY KEY,
     vessel_id bigint,
     change_type text,  -- 'NAME_CHANGE', 'FLAG_CHANGE', 'OWNER_CHANGE'
     field_name text,
     old_value text,
     new_value text,
     changed_at timestamptz,
     detected_at timestamptz,
     source_dataset_id bigint,
     verified boolean DEFAULT false
   );
   ```

2. **Change Pattern Detection**
   - Frequent reflagging (every 6 months = suspicious)
   - Name changes after sanctions
   - IMO/MMSI swaps
   - Ownership transfers

3. **Temporal Queries**
   ```graphql
   query VesselTimeline {
     vessel(imo: "8347301") {
       timeline {
         date
         changeType
         oldValue
         newValue
         source
         riskScore
       }
     }
   }
   ```

**Schema Support:** ✅ `vessel_identifiers.valid_from/valid_to` exists, but NOT populated
**Implementation:** 🔴 Need change detection logic in entity resolution

---

### Phase 3: Relationship Intelligence (HIGH PRIORITY)

**Problem:** Vessels don't operate in isolation - need ownership/operator networks

**Missing:**
1. **Ownership Tracking**
   ```sql
   -- Exists but empty!
   curated.vessel_associates (
     vessel_id,
     associate_type,  -- 'OWNER', 'OPERATOR', 'BENEFICIAL_OWNER', 'MANAGER'
     entity_id,       -- Links to entity_organizations or entity_persons
     valid_from,
     valid_to
   )
   ```

2. **Corporate Network Graphs**
   - Shell company chains
   - Beneficial ownership (who REALLY owns it?)
   - Operator networks (same operator = fleet intelligence)
   - Ship managers

3. **Association Patterns**
   - Multiple vessels with same owner suddenly reflag together
   - Ownership transfers to sanctioned entities
   - Ghost fleets (shared dark patterns)

**Schema Support:** ✅ Tables exist (`vessel_associates`, `entity_organizations`, `entity_persons`)
**Data Source:** 🔴 NOT in current parquet files - need to extract from PDFs/additional sources
**Implementation:** 🔴 Need PDF OCR pipeline + entity extraction

---

### Phase 4: Risk Scoring & Aggregation (MEDIUM PRIORITY)

**Problem:** Conflicts detected but not quantified as overall risk

**Missing:**
1. **Composite Risk Score**
   ```sql
   CREATE TABLE curated.vessel_risk_scores (
     vessel_id bigint,
     overall_score numeric(5,2),  -- 0-100
     category_scores jsonb,  -- {"identity": 45, "compliance": 80, "behavior": 30}
     risk_factors jsonb,
     calculated_at timestamptz,
     valid_until timestamptz
   );
   ```

2. **Risk Factor Weightings**
   ```json
   {
     "mmsi_collision": { "weight": 0.6, "category": "identity" },
     "frequent_reflagging": { "weight": 0.8, "category": "behavior" },
     "iuu_listed": { "weight": 1.0, "category": "compliance" },
     "ownership_opacity": { "weight": 0.7, "category": "ownership" },
     "flag_of_convenience": { "weight": 0.4, "category": "regulatory" }
   }
   ```

3. **Trend Analysis**
   - Risk increasing/decreasing over time
   - Correlation with known bad actors
   - Predictive risk modeling

**Schema Support:** ❌ Need new tables
**Implementation:** 🔴 Need risk scoring engine

---

### Phase 5: Compliance & Watchlist Integration (HIGH PRIORITY)

**Problem:** No external watchlist data loaded yet

**Missing:**
1. **IUU (Illegal, Unreported, Unregulated) Lists**
   - Regional IUU lists (EU, RFMO-specific)
   - Vessel Monitoring System (VMS) violations
   - Unreported fishing activity

2. **Sanctions Lists**
   ```sql
   -- Exists but empty!
   curated.vessel_sanctions (
     vessel_id,
     sanction_type,
     sanctioning_authority,
     effective_date,
     expiry_date,
     reason
   )
   ```

3. **WRO (Withhold Release Orders)**
   - US CBP enforcement
   - Forced labor flags
   - Import restrictions

4. **NGO Watchlists**
   - Outlaw Ocean investigations
   - Greenpeace ship tracker
   - Sea Shepherd reports

**Schema Support:** ✅ `vessel_sanctions`, `vessel_watchlist_events` exist
**Data Source:** 🔴 Need to integrate external APIs/datasets
**Implementation:** 🔴 Need watchlist loading pipeline

---

### Phase 6: Movement & Behavioral Intelligence (FUTURE)

**Problem:** No AIS or movement data

**Missing:**
1. **AIS Track Data**
   - Port visits
   - Fishing zones
   - Dark activity (AIS off periods)
   - Speed patterns
   - Rendezvous events (transshipment indicators)

2. **Geofencing Alerts**
   - Entry into protected zones
   - Presence in conflict areas
   - Distance from declared ports

3. **Behavioral Anomalies**
   - Unusual routes
   - Loitering patterns
   - Consistent dark periods

**Schema Support:** ❌ Need spatial tables
**Data Source:** 🔴 AIS feed integration (expensive!)
**Implementation:** 🔴 Requires streaming + spatial processing

---

### Phase 7: Document Intelligence (MEDIUM PRIORITY)

**Problem:** Lost connection to source documents

**Missing:**
1. **Source Document Tracking**
   ```sql
   CREATE TABLE curated.source_documents (
     id bigint PRIMARY KEY,
     vessel_id bigint,
     document_type text,  -- 'RFMO_REGISTRY', 'PORT_INSPECTION', 'OWNERSHIP_DOC'
     document_url text,
     extracted_at timestamptz,
     confidence numeric,
     ocr_text text,
     metadata jsonb
   );
   ```

2. **Evidence Trail**
   - Original PDFs/images
   - OCR confidence scores
   - Manual verification status
   - Annotation lineage

3. **Cross-Document Validation**
   - Same vessel, different docs, conflicting info?
   - Document date vs. reported change date
   - Authority verification

**Schema Support:** ✅ `stage.documents` exists for ingestion
**Link to Curated:** 🔴 Missing FK from `curated.vessel_identifiers` to `stage.documents`
**Implementation:** 🔴 Need document retention policy

---

### Phase 8: Data Quality Metrics (LOW PRIORITY but valuable)

**Missing:**
1. **Completeness Scores**
   ```json
   {
     "vessel_id": 11573,
     "completeness": {
       "identifiers": 0.6,  // Has IMO, IRCS, missing MMSI
       "ownership": 0.0,     // No owner data
       "compliance": 0.0,    // No watchlist matches
       "temporal": 0.3       // Some dates, missing history
     }
   }
   ```

2. **Data Freshness**
   - Last updated per source
   - Stale data warnings
   - Source reliability scores

3. **Confidence Aggregation**
   - Per-field confidence
   - Overall dossier confidence

---

## Priority Recommendations

### 🔴 Critical (Do Next)

1. **Populate Temporal Fields**
   - Use `valid_from`/`valid_to` in `vessel_identifiers`
   - Detect changes between data snapshots
   - Build `vessel_history` table

2. **Load Watchlist Data**
   - EU IUU list
   - OFAC sanctions
   - WRO enforcement data
   - Populate `vessel_sanctions` and `vessel_watchlist_events`

3. **Extract Ownership Data**
   - Parse owner fields from parquet
   - Create `entity_organizations` records
   - Link via `vessel_associates`

### 🟡 High Priority (Phase 2)

4. **Risk Scoring Engine**
   - Aggregate red flags into scores
   - Weight by severity
   - Track trends

5. **Change Detection**
   - Compare snapshots
   - Flag suspicious patterns
   - Alert on high-risk changes

### 🟢 Medium Priority (Phase 3)

6. **Document Retention**
   - Link identifiers to source docs
   - Store OCR outputs
   - Enable evidence review

7. **Network Analysis**
   - Ownership graphs
   - Fleet analysis
   - Shell company detection

### ⚪ Future Enhancements

8. **AIS Integration**
9. **Predictive Modeling**
10. **Automated Classification**

---

## Current Intelligence Capability Assessment

| Dimension | Current State | Missing | Impact |
|-----------|---------------|---------|--------|
| **Source Attribution** | ✅ Full | None | Can trace who said what |
| **Conflict Detection** | ✅ Basic | Advanced patterns | Can spot MMSI/IMO issues |
| **Temporal Tracking** | 🟡 Schema only | Change detection | Cannot see evolution |
| **Ownership** | ❌ None | All data | Blind to beneficial owners |
| **Compliance** | ❌ None | All lists | Missing sanctions/IUU |
| **Risk Scoring** | ❌ None | Scoring engine | No quantified risk |
| **Movement** | ❌ None | AIS data | No behavioral intel |
| **Documents** | 🟡 Partial | Linking | Cannot verify claims |

---

## Example: Complete Intelligence Dossier (Future State)

```json
{
  "vessel": {
    "imo": "8347301",
    "primary_name": "Ryosei Maru No. 26",
    "risk_score": 72,
    "risk_level": "HIGH"
  },
  "identifiers": {
    "imo": { "value": "8347301", "confidence": 1.0, "verified": true },
    "mmsi": {
      "value": "431800172",
      "confidence": 0.3,
      "red_flag": "COLLISION - also claimed by IMO 2397005"
    },
    "names": [
      { "value": "Ryosei Maru No. 26", "valid_from": "2020-01-01", "valid_to": null },
      { "value": "Ocean Spirit", "valid_from": "2018-06-01", "valid_to": "2019-12-31", "red_flag": "NAME_CHANGE after IUU listing" }
    ]
  },
  "ownership": {
    "beneficial_owner": "Sea Ventures Ltd (Shell - BVI)",
    "operator": "Pacific Fishing Co",
    "manager": "Unknown",
    "ownership_opacity_score": 0.85,
    "red_flag": "Beneficial owner is shell company in tax haven"
  },
  "compliance": {
    "iuu_listed": true,
    "iuu_authority": "EU",
    "iuu_date": "2019-10-15",
    "sanctions": [],
    "wro_flags": []
  },
  "behavioral_intelligence": {
    "reflagging_frequency": "3 flags in 2 years",
    "dark_periods": "47% of time AIS off",
    "high_risk_zones": ["South China Sea EEZ violations"],
    "transshipment_events": 12
  },
  "red_flags": [
    { "type": "MMSI_COLLISION", "severity": "HIGH", "detected": "2025-11-07" },
    { "type": "NAME_CHANGE_POST_IUU", "severity": "CRITICAL", "detected": "2020-01-05" },
    { "type": "OWNERSHIP_OPACITY", "severity": "HIGH", "detected": "2024-08-12" },
    { "type": "FREQUENT_REFLAGGING", "severity": "MEDIUM", "detected": "2024-12-01" }
  ],
  "timeline": [
    { "date": "2018-06-01", "event": "Vessel named 'Ocean Spirit'", "source": "IOTC" },
    { "date": "2019-10-15", "event": "Added to EU IUU list", "source": "EU Commission" },
    { "date": "2020-01-01", "event": "Name changed to 'Ryosei Maru No. 26'", "source": "NPFC", "red_flag": true },
    { "date": "2021-03-12", "event": "Reflagged to Panama", "source": "IMO" },
    { "date": "2023-07-08", "event": "Ownership transferred to Sea Ventures Ltd", "source": "Corporate registry" },
    { "date": "2025-11-07", "event": "MMSI collision detected", "source": "EBISU" }
  ]
}
```

---

## Bottom Line

**We have the schema for true intelligence, but missing:**

1. **Temporal data population** (change detection)
2. **Ownership data extraction** (beneficial owners)
3. **External watchlist integration** (IUU, sanctions, WRO)
4. **Risk scoring aggregation** (quantified risk)
5. **Document evidence linking** (proof chain)

**Next action:** Load watchlist data + extract ownership from existing parquet files.
