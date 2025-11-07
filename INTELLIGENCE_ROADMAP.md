# Vessel Intelligence System Roadmap

**Created:** 2025-11-06

## Current State: MVP Data Layer

### What You Have Now ✅

```
36,122 raw records from 11 RFMOs
  ↓
Simple PostgreSQL table
  ↓
PostGraphile GraphQL API
  ↓
@ocean UI (search & detail)
```

**Capabilities:**
- Basic vessel search (name, IMO, MMSI)
- Source attribution (which RFMO)
- Entity IDs (but duplicates exist)
- Raw field access (200+ columns)

**Limitations:**
- ❌ No entity resolution (same vessel = multiple records)
- ❌ No historical tracking (changes over time)
- ❌ No collision detection (IMO/MMSI conflicts)
- ❌ No compliance data (IUU, sanctions, WRO)
- ❌ No data quality scoring
- ❌ No ownership graphs
- ❌ No movement/position data

---

## True Intelligence System: What You Need

### Core Capabilities

#### 1. **Entity Resolution** (Foundation)

**Problem:** IMO 9086758 appears 4 times in your data
- 3x from CCSBT (duplicate snapshots)
- 1x from IOTC (different authorization)

**Solution:** EBISU Schema
```
Multiple raw records → Entity resolution → One canonical vessel
                                            + Full change history
```

**What it gives you:**
- One `vessel_uuid` per physical vessel
- All name changes tracked in `vessel_reported_history`
- All flag changes tracked
- All identifier changes tracked
- Confidence scores per field

**Schema:**
```sql
ebisu.vessels                    -- Current canonical state (1 row per vessel)
  vessel_uuid UUID PRIMARY KEY
  vessel_name TEXT               -- Current name
  imo TEXT                       -- Current IMO
  mmsi TEXT                      -- Current MMSI
  vessel_flag TEXT               -- Current flag
  created_at, updated_at

ebisu.vessel_reported_history    -- All historical values
  history_uuid UUID PRIMARY KEY
  vessel_uuid UUID               -- Links to canonical vessel
  reported_history_type TEXT     -- 'VESSEL_NAME_CHANGE', 'IMO_CHANGE', etc
  identifier_value TEXT          -- The actual value
  reported_at TIMESTAMPTZ        -- When this was reported
  source_id INT                  -- Which RFMO/source
  confidence FLOAT               -- How confident are we?
```

#### 2. **Collision Detection & Resolution** (Data Quality)

**Problem:** Multiple vessels claiming same unique identifier

**Examples from your data:**
- IMO "NE" - 482 vessels (clearly wrong)
- IMO "PENDING" - 288 vessels (placeholder)
- Valid IMOs with 2-21 duplicate entries

**Solution:** Load Collisions Table
```sql
ebisu.load_collisions
  id UUID PRIMARY KEY
  id_type TEXT                   -- 'imo' or 'mmsi'
  id_value TEXT                  -- '9086758'
  vessel_uuid UUID               -- First vessel
  other_vessel_uuid UUID         -- Conflicting vessel
  detected_at TIMESTAMPTZ
  status TEXT                    -- 'NEW', 'ACKNOWLEDGED', 'RESOLVED'
  resolution_type TEXT           -- 'CHOOSE_EXISTING', 'MERGE_ENTITIES', etc
  reviewed_by TEXT
  reviewed_at TIMESTAMPTZ
  notes TEXT
```

**Workflow:**
1. Detect collision during load
2. Create collision record
3. Admin reviews (via Argilla or SQL)
4. Apply resolution strategy
5. Update canonical vessel
6. Audit trail preserved

#### 3. **Multi-Source Reconciliation** (Truth Discovery)

**Problem:** Same vessel, different data from different sources

**Example:**
```
ICCAT says: IMO 9086758, Flag "Japan", Name "TAISEI MARU NO.24"
IOTC says:  IMO 9086758, Flag "JPN",   Name "TAISEI MARU 24"
```

**Solution:** Confidence-weighted fields
```sql
-- Each source has reliability score
control.sources
  source_id INT
  source_shortname TEXT          -- 'ICCAT'
  reliability_score FLOAT        -- 0.0 - 1.0

-- Each assertion tracked with confidence
vessel_reported_history
  source_id INT
  confidence FLOAT               -- Field-level confidence

-- Canonical record = highest confidence value
-- Or manual override when sources conflict
```

#### 4. **Compliance Intelligence** (Risk Indicators)

**Data Sources to Integrate:**

**IUU Lists:**
- RFMO IUU vessel lists (you partially have this)
- National IUU lists (EU, US, etc)
- Format: vessel identifiers + listing date + reason

**Sanctions & Enforcement:**
- OFAC Specially Designated Nationals (SDN)
- EU Sanctions
- UN Security Council lists
- Format: owner/operator names + vessel identifiers

**Withhold Release Orders (WRO):**
- US Customs WROs (forced labor)
- Format: vessel names + operators + detention records

**Outlaw Ocean Database:**
- Investigative journalism database
- Human rights violations
- Illegal fishing allegations
- Format: vessel identifiers + incident details

**Schema:**
```sql
ebisu.vessels_iuu_simple
  vessel_uuid UUID
  list_source TEXT               -- 'ICCAT_IUU', 'EU_IUU'
  listed_date DATE
  delisted_date DATE
  reason TEXT
  is_active BOOLEAN

ebisu.wro_enforcement
  vessel_uuid UUID
  wro_number TEXT
  issue_date DATE
  operator TEXT
  violation_type TEXT

ebisu.vessels_outlaw_ocean
  vessel_uuid UUID
  incident_date DATE
  incident_type TEXT
  description TEXT
  source_url TEXT
```

**UI Impact:**
```typescript
{
  vesselName: "Example Vessel",
  compliance: {
    iuu: { status: "LISTED", source: "ICCAT", since: "2023-01" },
    wro: { status: "ACTIVE", number: "WRO-2024-001" },
    outlawOcean: { incidents: 2, lastIncident: "2024-05" }
  }
}
```

#### 5. **Ownership Intelligence** (Beneficial Owner Tracking)

**Problem:** Corporate structures hide true ownership

**Solution:** Vessel Associates Graph
```sql
ebisu.vessel_associates
  associate_uuid UUID
  vessel_uuid UUID
  associate_type TEXT            -- 'OWNER', 'OPERATOR', 'CAPTAIN', 'BUILDER'
  entity_name TEXT               -- Person or company name
  entity_country TEXT
  start_date DATE
  end_date DATE
  confidence FLOAT
  source_id INT

-- Links entities
ebisu.entity_relationships
  parent_entity UUID
  child_entity UUID
  relationship_type TEXT         -- 'SUBSIDIARY', 'PARENT_COMPANY', 'BENEFICIAL_OWNER'
  ownership_percentage FLOAT
```

**Enables:**
- "Show all vessels owned by Company X"
- "Map corporate structure"
- "Flag reflagging with same owner" (IUU evasion tactic)
- "Identify shell company patterns"

#### 6. **Movement Intelligence** (AIS Integration)

**Data Source:** AIS (Automatic Identification System)

**Schema:**
```sql
ebisu.vessel_positions
  vessel_uuid UUID
  mmsi TEXT
  timestamp TIMESTAMPTZ
  latitude FLOAT
  longitude FLOAT
  speed_knots FLOAT
  course_degrees FLOAT
  heading_degrees FLOAT
  status TEXT                    -- 'UNDERWAY', 'AT_ANCHOR', 'FISHING'

ebisu.port_calls
  vessel_uuid UUID
  port_code TEXT
  arrival_time TIMESTAMPTZ
  departure_time TIMESTAMPTZ
  duration_hours FLOAT

ebisu.fishing_events
  vessel_uuid UUID
  event_type TEXT                -- 'FISHING', 'TRANSHIPMENT', 'ENCOUNTER'
  start_time TIMESTAMPTZ
  end_time TIMESTAMPTZ
  location GEOGRAPHY
  confidence FLOAT
```

**Enables:**
- "Where is this vessel now?"
- "Has this vessel entered restricted zones?"
- "Detect dark events" (AIS off in fishing grounds)
- "Identify transhipment at sea"
- "Track port visits"

#### 7. **Data Quality Metrics** (Trust Scoring)

**Problem:** How reliable is this data?

**Schema:**
```sql
ebisu.data_quality_metrics
  vessel_uuid UUID
  completeness_score FLOAT       -- % of fields populated
  consistency_score FLOAT        -- Do sources agree?
  recency_score FLOAT           -- How recent is data?
  source_diversity INT          -- # of confirming sources
  conflict_count INT            -- # of unresolved conflicts
  last_verified TIMESTAMPTZ
  overall_confidence FLOAT      -- Composite score
```

**Exposed in API:**
```typescript
{
  vesselName: "Example",
  dataQuality: {
    confidence: 0.87,             // High confidence
    lastVerified: "2024-11",
    sources: 5,                   // 5 RFMOs confirm
    conflicts: 0                  // No unresolved issues
  }
}
```

---

## The Gap: What You're Missing

### Critical Foundation (Blocking Intelligence)

| Component | Status | Impact |
|-----------|--------|--------|
| **Entity Resolution** | ❌ Missing | Can't answer "show me all data for vessel X" |
| **EBISU Schema** | ❌ Not applied | No canonical records, just raw data |
| **History Tracking** | ❌ Missing | Can't show changes over time |
| **Collision Detection** | ❌ Missing | Bad data propagates |

### Intelligence Layers (Adds Value)

| Component | Status | Impact |
|-----------|--------|--------|
| **Compliance Data** | ❌ Missing | Can't flag risky vessels |
| **Ownership Data** | 🟡 Partial | Some fields in raw data, not structured |
| **Quality Scoring** | ❌ Missing | Can't assess reliability |
| **Multi-source Reconciliation** | ❌ Missing | Conflicting data, no resolution |

### Advanced Capabilities (Future)

| Component | Status | Impact |
|-----------|--------|--------|
| **AIS Movement** | ❌ Missing | No positioning/tracking |
| **Port Calls** | ❌ Missing | Can't trace routes |
| **Fishing Events** | ❌ Missing | No behavioral analysis |
| **Network Analysis** | ❌ Missing | Can't map ownership webs |

---

## Actionable Roadmap

### Phase 1: Foundation (4-6 weeks)

**Goal:** Transform raw data → canonical vessels with history

**Tasks:**

1. **Apply EBISU Migrations**
   ```bash
   cd /Users/rt/Developer/oceanid

   # Apply all migrations (V1-V12)
   for f in sql/migrations/V*.sql; do
     PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d vessels -f "$f"
   done

   # Apply views/functions
   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d vessels -f sql/vessels_lookup.sql
   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d vessels -f sql/ebisu_stage.sql
   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d vessels -f sql/ebisu_transform.sql
   ```

2. **Load Data to Staging**
   ```bash
   export CB_HOST=localhost CB_PORT=5433 CB_USER=postgres CB_PASS=postgres CB_DB=vessels
   make cb.stage.load
   ```

3. **Run Entity Resolution**
   ```bash
   make cb.ebisu.process
   ```

4. **Verify Results**
   ```sql
   SELECT COUNT(*) FROM ebisu.vessels;                    -- Should be ~7,666 (unique IMOs)
   SELECT COUNT(*) FROM ebisu.vessel_reported_history;    -- Should be ~36k (all reports)
   ```

**Output:**
- ✅ One canonical record per vessel
- ✅ Full history preserved
- ✅ Entity IDs stable
- ✅ `ui_vessel_report` view available for @ocean

**Effort:** 1 week (mostly migration application + testing)

---

### Phase 2: Data Quality (2-3 weeks)

**Goal:** Detect and resolve data conflicts

**Tasks:**

1. **Enable Collision Detection**
   ```sql
   -- Already in ebisu_transform.sql
   -- Just verify it's running
   SELECT * FROM ebisu.load_collisions WHERE status = 'NEW' LIMIT 10;
   ```

2. **Set Up Review Workflow**
   - Option A: Direct SQL review
   ```sql
   -- Review collision
   SELECT * FROM ebisu.load_collisions WHERE id_value = '9086758';

   -- Resolve (keep first vessel)
   UPDATE ebisu.load_collisions
   SET status = 'RESOLVED',
       resolution_type = 'CHOOSE_EXISTING',
       reviewed_at = NOW()
   WHERE id_value = '9086758';
   ```

   - Option B: Use Argilla for batch review
   ```python
   # scripts/collision_review_argilla.py
   import argilla as rg

   # Export collisions to Argilla dataset
   # SME reviews, applies resolution
   # Script updates database
   ```

3. **Add Source Reliability Scores**
   ```sql
   UPDATE control.sources SET reliability_score = 0.95 WHERE source_shortname = 'ICCAT';
   UPDATE control.sources SET reliability_score = 0.90 WHERE source_shortname = 'IOTC';
   -- etc
   ```

4. **Implement Confidence Scoring**
   ```sql
   -- Update vessel_reported_history with confidence
   UPDATE ebisu.vessel_reported_history h
   SET confidence = s.reliability_score *
       CASE
         WHEN h.identifier_value IS NOT NULL THEN 1.0
         ELSE 0.5
       END
   FROM control.sources s
   WHERE h.source_id = s.source_id;
   ```

**Output:**
- ✅ Collisions detected and flagged
- ✅ Review workflow established
- ✅ Confidence scores per assertion
- ✅ Source reliability tracked

**Effort:** 2-3 weeks (includes manual review of top conflicts)

---

### Phase 3: Compliance Integration (3-4 weeks)

**Goal:** Add IUU, sanctions, and enforcement data

**Tasks:**

1. **Acquire Data Sources**
   - Download RFMO IUU lists (publicly available)
   - EU IUU list (public)
   - OFAC SDN list (public API)
   - WRO list (scrape CBP.gov or manual)
   - Outlaw Ocean DB (partnership/purchase?)

2. **Create Compliance Tables**
   ```sql
   -- Already defined in migrations, just load data
   CREATE TABLE ebisu.vessels_iuu_simple (
     vessel_uuid UUID REFERENCES ebisu.vessels(vessel_uuid),
     list_source TEXT,
     listed_date DATE,
     delisted_date DATE,
     reason TEXT,
     is_active BOOLEAN DEFAULT true
   );
   ```

3. **Build ETL Pipelines**
   ```python
   # scripts/load_iuu_lists.py
   import pandas as pd

   # Parse ICCAT IUU list
   iuu_df = pd.read_csv('data/compliance/iccat_iuu_2024.csv')

   # Match to vessels by IMO
   # Insert to vessels_iuu_simple
   ```

4. **Expose in PostGraphile**
   ```sql
   -- Add to ui_vessel_report view
   CREATE OR REPLACE VIEW public.ui_vessel_report AS
   SELECT
     v.*,
     EXISTS(SELECT 1 FROM ebisu.vessels_iuu_simple i
            WHERE i.vessel_uuid = v.vessel_uuid AND i.is_active) AS is_iuu_listed,
     EXISTS(SELECT 1 FROM ebisu.wro_enforcement w
            WHERE w.vessel_uuid = v.vessel_uuid) AS has_wro
   FROM ebisu.vessels v;
   ```

**Output:**
- ✅ IUU status in vessel records
- ✅ WRO flags available
- ✅ Sanctions screening ready
- ✅ @ocean UI shows compliance badges

**Effort:** 3-4 weeks (data acquisition + ETL + testing)

---

### Phase 4: Ownership Intelligence (4-6 weeks)

**Goal:** Track ownership and corporate relationships

**Tasks:**

1. **Extract Owner Data from Raw Records**
   ```sql
   -- Parse owner fields from public.vessels
   INSERT INTO ebisu.vessel_associates (vessel_uuid, associate_type, entity_name)
   SELECT
     v.vessel_uuid,
     'OWNER',
     pv.owner_name
   FROM public.vessels pv
   JOIN ebisu.vessels v ON v.imo = pv.imo
   WHERE pv.owner_name IS NOT NULL;
   ```

2. **Entity Resolution for Companies**
   ```python
   # scripts/dedupe_owners.py
   # Fuzzy match owner names
   # "ABC Fishing Co." = "ABC Fishing Company" = same entity
   ```

3. **Add Beneficial Owner Data**
   - Manual research for key vessels
   - OpenCorporates API integration
   - Ship registries (Panama, Liberia, etc)

4. **Build Ownership Graphs**
   ```sql
   CREATE TABLE ebisu.entity_relationships (
     parent_entity UUID,
     child_entity UUID,
     relationship_type TEXT,
     ownership_percentage FLOAT
   );
   ```

**Output:**
- ✅ Owner data structured
- ✅ Corporate relationships mapped
- ✅ "Show all vessels by owner" queries
- ✅ Shell company detection ready

**Effort:** 4-6 weeks (labor intensive, needs research)

---

### Phase 5: Movement Intelligence (8-12 weeks)

**Goal:** Integrate AIS positioning data

**Tasks:**

1. **Acquire AIS Data**
   - Historical: Purchase from MarineTraffic, VesselFinder, Spire
   - Real-time: Subscribe to AIS feed
   - Cost: $$$ (this is expensive)

2. **Build Position Storage**
   ```sql
   CREATE TABLE ebisu.vessel_positions (
     vessel_uuid UUID,
     timestamp TIMESTAMPTZ,
     location GEOGRAPHY(POINT),
     speed FLOAT,
     course FLOAT
   );

   -- Partitioned by month for performance
   CREATE TABLE ebisu.vessel_positions_2024_11
     PARTITION OF ebisu.vessel_positions
     FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');
   ```

3. **Build AIS Ingestion Pipeline**
   ```python
   # apps/ais-ingestion-worker/
   # Consume AIS stream
   # Match MMSI → vessel_uuid
   # Write to vessel_positions
   ```

4. **Detect Events**
   ```python
   # Fishing event detection (speed + turns)
   # Transhipment detection (vessels close together)
   # Dark events (AIS off in fishing zones)
   # Port calls (geofence triggers)
   ```

**Output:**
- ✅ Real-time vessel positions
- ✅ Historical tracks
- ✅ Fishing event detection
- ✅ Port call history

**Effort:** 8-12 weeks (complex, expensive, requires ML)

---

## Priority Matrix

### Must Have (For Basic Intelligence)

| Priority | Component | Weeks | Unblocks |
|----------|-----------|-------|----------|
| **P0** | EBISU Schema | 1 | Everything else |
| **P0** | Entity Resolution | 1 | Canonical records |
| **P1** | Collision Detection | 2 | Data quality |
| **P1** | Historical Tracking | 0 | (Built into EBISU) |

### Should Have (For Useful Intelligence)

| Priority | Component | Weeks | Value |
|----------|-----------|-------|-------|
| **P2** | Compliance Data (IUU) | 3 | Risk screening |
| **P2** | Source Reliability | 1 | Trust scoring |
| **P3** | Owner Extraction | 4 | Corporate links |

### Nice to Have (Advanced Intelligence)

| Priority | Component | Weeks | Value |
|----------|-----------|-------|-------|
| **P4** | WRO Integration | 2 | US market access |
| **P4** | Outlaw Ocean | 2 | Investigative data |
| **P5** | AIS Movement | 12 | Real-time tracking |
| **P5** | Ownership Graphs | 6 | Network analysis |

---

## Quick Wins (Do This Week)

### 1. Apply EBISU Migrations ⚡

**Impact:** Massive (enables everything)
**Effort:** 2 hours
**Command:**
```bash
cd /Users/rt/Developer/oceanid
for f in sql/migrations/V*.sql; do
  PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d vessels -f "$f"
done
```

### 2. Run Entity Resolution ⚡

**Impact:** ~31k vessels → ~7.6k canonical vessels
**Effort:** 1 hour
**Command:**
```bash
export CB_HOST=localhost CB_PORT=5433 CB_USER=postgres CB_PASS=postgres CB_DB=vessels
make cb.stage.load
make cb.ebisu.process
```

### 3. Enable ui_vessel_report View ⚡

**Impact:** @ocean gets historical data immediately
**Effort:** 5 minutes
**Command:**
```bash
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d vessels -f sql/vessels_lookup.sql
```

**@ocean can now query:**
```graphql
query {
  uiVesselReport(entityId: "uuid-here") {
    currentName
    currentImo
    names        # All historical names!
    imos         # All historical IMOs!
    rfmos        # All sources!
    historyCount
    hasImoConflict
  }
}
```

---

## What You Can Do While UI Team Works

### Week 1: Foundation

- [ ] Apply EBISU migrations locally
- [ ] Run entity resolution
- [ ] Verify canonical vessels created
- [ ] Test ui_vessel_report view
- [ ] Update PostGraphile contract for @ocean

### Week 2: Data Quality

- [ ] Review top 20 IMO collisions
- [ ] Resolve manually or set up Argilla
- [ ] Add source reliability scores
- [ ] Document data quality metrics

### Week 3: Compliance Prep

- [ ] Download ICCAT IUU list
- [ ] Download EU IUU list
- [ ] Design compliance ETL pipeline
- [ ] Create load_iuu_lists.py script

### Week 4: Compliance Load

- [ ] Parse IUU lists
- [ ] Match to vessels by IMO
- [ ] Load to vessels_iuu_simple
- [ ] Expose in ui_vessel_report
- [ ] Notify @ocean team (new fields available!)

### Weeks 5-6: Ownership

- [ ] Extract owner names from raw data
- [ ] Dedupe company names
- [ ] Load to vessel_associates
- [ ] Test ownership queries

---

## Success Metrics

### Intelligence Maturity Model

**Level 1: Raw Data** (Current)
- Can search vessels
- Can view raw fields
- No deduplication
- No history
- No compliance

**Level 2: Structured Intelligence** (After Phase 1)
- Canonical vessel records
- Historical tracking
- Multi-source reconciliation
- Collision detection
- Quality scoring

**Level 3: Risk Intelligence** (After Phase 3)
- IUU screening
- Sanctions checking
- WRO flags
- Ownership tracking
- Compliance dashboard

**Level 4: Predictive Intelligence** (After Phase 5)
- Movement tracking
- Behavior analysis
- Risk prediction
- Network analysis
- Real-time alerts

### Key Metrics

| Metric | Current | Target (L2) | Target (L3) |
|--------|---------|-------------|-------------|
| Canonical vessels | 0 | 7,666 | 7,666 |
| Historical records | 0 | 36k+ | 50k+ |
| Compliance coverage | 0% | 0% | 80% |
| Data quality score | N/A | 0.75 | 0.85 |
| Source diversity | 11 | 11 | 15+ |
| Ownership links | 0 | 0 | 5k+ |

---

## Summary

### What You Have
- ✅ Raw vessel data (36k records)
- ✅ Basic GraphQL API
- ✅ Working @ocean UI

### What You Need (Priority Order)
1. **EBISU Schema** (P0, 1 week) - Apply migrations
2. **Entity Resolution** (P0, 1 week) - Run transform
3. **Collision Resolution** (P1, 2 weeks) - Review + fix
4. **Compliance Data** (P2, 3 weeks) - Load IUU lists
5. **Ownership** (P3, 4 weeks) - Extract + structure
6. **AIS Movement** (P4, 12 weeks) - Future

### Next Step
Apply EBISU migrations this week. Everything else builds on this foundation.

**The gap is not insurmountable - you can have a real intelligence system in 8-10 weeks! 🚀**
