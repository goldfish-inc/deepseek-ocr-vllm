# Deployment Guide: Schema Migrations V3-V6

**Status:** Ready for deployment
**Date:** 2025-09-30
**Related Issues:** #52 (schema alignment), #53 (implementation)

---

## Overview

This guide covers deployment of schema migrations V3-V6 to align NER taxonomy with database schema, enabling:

- ML-powered CSV cleaning pipeline (#48, #49)
- FK validation for FLAG/RFMO/GEAR_TYPE/SPECIES labels
- Temporal intelligence tracking (reflagging, authorizations, sanctions)
- Hybrid typed + EAV vessel metadata storage

---

## Prerequisites

### 1. PostgreSQL Extensions

**Required extensions** (enable once per database):

```sql
-- Connect as superuser or rds_superuser
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- For gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS postgis;    -- For geometry columns
CREATE EXTENSION IF NOT EXISTS btree_gist; -- For temporal exclusion constraints
```

**Why needed:**

- `pgcrypto`: UUID primary keys in V4/V5 (e.g., `curated.country_iso.id`)
- `postgis`: Geographic data (RFMO competence areas, port locations, violation sites)
- `btree_gist`: Temporal exclusion constraints (prevent overlapping vessel flag periods)

**Verification:**

```bash
# Check extensions are available
psql $DATABASE_URL -c "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name IN ('pgcrypto', 'postgis', 'btree_gist');"

# Enable extensions (requires elevated privileges)
psql $DATABASE_URL <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
SQL

# Verify enabled
psql $DATABASE_URL -c "\dx" | grep -E '(pgcrypto|postgis|btree_gist)'
```

---

## Migration Sequence

**Apply in order** (Flyway versioning enforces this automatically):

| Migration | Tables Added | Purpose |
|-----------|--------------|---------|
| V1 (existing) | stage.documents, stage.extractions, curated.vessels (skeleton) | Baseline staging + curated schemas |
| V2 (existing) | Views: v_extractions_mapped, v_duplicate_candidates | Deduplication and mapping views |
| **V3** | stage.cleaning_rules, stage.csv_extractions, stage.training_corpus, stage.promotion_log, stage.document_processing_log | ML-powered CSV cleaning pipeline |
| **V4** | curated.country_iso, curated.rfmos, curated.gear_types_fao, curated.harmonized_species, curated.ports, code tables | Reference data for FK validation |
| **V5** | curated.vessel_flag_history, curated.vessel_authorizations, curated.vessel_sanctions, curated.vessel_associates, curated.vessel_metrics, conflict/confirmation tables | Temporal intelligence tracking |
| **V6** | Alter curated.vessel_info (add typed columns) | Resolve labels.json → schema mapping |

---

## Deployment Steps

### Step 1: Enable Extensions

#### Option A: CrunchyBridge (Recommended)

```bash
# Get database URL from Pulumi ESC (all secrets stored in ESC)
export DATABASE_URL=$(pulumi -C cluster config get postgres_url --plaintext)

# CrunchyBridge automatically has extensions available - just enable them
psql $DATABASE_URL <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
SQL
```

**CrunchyBridge advantages:**

- Extensions pre-installed (no package installation needed)
- Superuser privileges available
- Managed backups (WAL-based, point-in-time recovery)
- High availability built-in
- Connection string stored securely in Pulumi ESC

#### Option B: Self-Hosted PostgreSQL

```bash
# Production database
export DATABASE_URL="postgresql://user:password@host:5432/oceanid_staging"

# Enable extensions (run as superuser or database owner with CREATE EXTENSION privilege)
psql $DATABASE_URL <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
SQL

# Verify
psql $DATABASE_URL -c "\dx pgcrypto"
psql $DATABASE_URL -c "\dx postgis"
psql $DATABASE_URL -c "\dx btree_gist"
```

**Troubleshooting:**

- **Permission denied**: Extensions require superuser or `rds_superuser` role (AWS RDS)
- **Extension not found**: Install packages (Debian: `postgresql-contrib`, `postgis`, Red Hat: `postgresql-server-devel`, `postgis`)

---

### Step 2: Backup Database

```bash
# Full backup before migration
pg_dump $DATABASE_URL --clean --if-exists --create \
  --format=custom --file=oceanid_staging_pre_v3_$(date +%Y%m%d_%H%M%S).dump

# Verify backup
pg_restore --list oceanid_staging_pre_v3_*.dump | head -20
```

**Rollback procedure:**

```bash
# If migration fails, restore from backup
pg_restore --clean --if-exists --dbname=$DATABASE_URL oceanid_staging_pre_v3_*.dump
```

---

### Step 3: Apply Migrations

#### Option A: Flyway (Recommended)

```bash
# Install Flyway (if not present)
brew install flyway  # macOS
# or download from https://flywaydb.org/

# Configure Flyway
cat > flyway.conf <<EOF
flyway.url=jdbc:postgresql://host:5432/oceanid_staging
flyway.user=username
flyway.password=password
flyway.locations=filesystem:sql/migrations
flyway.table=flyway_schema_history
EOF

# Run migrations
flyway migrate

# Verify
flyway info
psql $DATABASE_URL -c "SELECT version, description, installed_on FROM flyway_schema_history ORDER BY installed_rank;"
```

#### Option B: Manual psql

```bash
# Apply migrations in order
psql $DATABASE_URL -f sql/migrations/V3__staging_tables_complete.sql
psql $DATABASE_URL -f sql/migrations/V4__curated_reference_tables.sql
psql $DATABASE_URL -f sql/migrations/V5__curated_temporal_events.sql
psql $DATABASE_URL -f sql/migrations/V6__vessel_info_typed_columns.sql

# Check for errors
echo $?  # Should be 0 for success
```

---

### Step 4: Load Seed Data

```bash
# Load cleaning rules extracted from pandas scripts
psql $DATABASE_URL -f sql/seed_cleaning_rules.sql

# Verify
psql $DATABASE_URL -c "SELECT COUNT(*) AS total_rules, COUNT(*) FILTER (WHERE enabled = true) AS enabled_rules FROM stage.cleaning_rules;"
# Expected: >5000 total rules, >4500 enabled

# Verify RFMOs seeded (from V4 migration)
psql $DATABASE_URL -c "SELECT code, full_name FROM curated.rfmos ORDER BY code;"
# Expected: 13 rows (CCAMLR, CCSBT, GFCM, IATTC, ICCAT, IOTC, NAFO, NEAFC, NPFC, SEAFO, SIOFA, SPRFMO, WCPFC)
```

---

### Step 5: Validation Queries

```bash
# Verify staging tables exist
psql $DATABASE_URL <<'SQL'
\d stage.cleaning_rules
\d stage.csv_extractions
\d stage.training_corpus
\d stage.promotion_log
\d stage.document_processing_log
SQL

# Verify reference tables populated
psql $DATABASE_URL -c "SELECT COUNT(*) FROM curated.rfmos;"                    # Expected: 13
psql $DATABASE_URL -c "SELECT COUNT(*) FROM curated.authorization_types;"      # Expected: 7
psql $DATABASE_URL -c "SELECT COUNT(*) FROM curated.sanction_types;"           # Expected: 7
psql $DATABASE_URL -c "SELECT COUNT(*) FROM curated.association_types;"        # Expected: 8
psql $DATABASE_URL -c "SELECT COUNT(*) FROM curated.unit_types;"               # Expected: 10
psql $DATABASE_URL -c "SELECT COUNT(*) FROM curated.organization_types;"       # Expected: 9

# Verify temporal tables exist
psql $DATABASE_URL -c "\d curated.vessel_flag_history"
psql $DATABASE_URL -c "\d curated.vessel_authorizations"
psql $DATABASE_URL -c "\d curated.vessel_sanctions"
psql $DATABASE_URL -c "\d curated.vessel_associates"
psql $DATABASE_URL -c "\d curated.vessel_metrics"

# Verify typed columns added to vessel_info
psql $DATABASE_URL -c "\d curated.vessel_info" | grep -E '(vessel_type|build_year|risk_level|risk_score)'

# Test views (should return 0 rows but no errors)
psql $DATABASE_URL -c "SELECT * FROM stage.v_review_queue LIMIT 1;"
psql $DATABASE_URL -c "SELECT * FROM stage.v_auto_promotable LIMIT 1;"
psql $DATABASE_URL -c "SELECT * FROM curated.v_vessels_current_state LIMIT 1;"
psql $DATABASE_URL -c "SELECT * FROM curated.v_authorizations_expiring_soon LIMIT 1;"

# Check for geometry columns (PostGIS)
psql $DATABASE_URL -c "SELECT f_table_name, f_geometry_column, type, srid FROM geometry_columns WHERE f_table_schema = 'curated';"
# Expected: rfmos.area_of_competence (Polygon, 4326), ports.coordinates (Point, 4326), vessel_sanctions.violation_location (Point, 4326)
```

---

### Step 6: Performance Verification

```bash
# Check index creation
psql $DATABASE_URL -c "SELECT schemaname, tablename, indexname FROM pg_indexes WHERE schemaname IN ('stage', 'curated') ORDER BY tablename, indexname;"

# Expected key indices:
# - stage.cleaning_rules: ix_cleaning_rules_type, ix_cleaning_rules_priority
# - stage.csv_extractions: ix_csv_extractions_doc, ix_csv_extractions_needs_review, ix_csv_extractions_confidence
# - curated.country_iso: ix_country_iso_alpha2, ix_country_iso_alpha3, ix_country_iso_mid
# - curated.rfmos: ix_rfmos_code, ix_rfmos_geo
# - curated.vessel_authorizations: ix_vessel_authorizations_vessel, ix_vessel_authorizations_rfmo, ix_vessel_authorizations_current
# - curated.vessel_sanctions: ix_vessel_sanctions_active, ix_vessel_sanctions_geo
# - curated.vessel_info: ix_vessel_info_vessel_type, ix_vessel_info_risk_level

# Verify temporal exclusion constraints (prevent overlapping flag periods)
psql $DATABASE_URL -c "\d curated.vessel_flag_history" | grep EXCLUDE
# Expected: EXCLUDE USING gist (vessel_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
```

---

## Post-Deployment Tasks

### 1. Update Application Configuration

**Adapter environment variables:**

```bash
# Load labels.json at startup
export NER_LABELS=$(cat labels.json | jq -c '.labels | map(.label)')

# Verify adapter can connect to database
export DATABASE_URL="postgresql://user:password@host:5432/oceanid_staging"

# Restart adapter
docker restart ls-triton-adapter
```

**Health check verification:**

```bash
curl http://localhost:8080/health | jq
# Expected: {"ok": true, "database": "connected", "triton": "connected"}
```

---

### 2. Seed Additional Reference Data

**Country ISO codes** (200+ countries with MID codes):

```bash
# TODO: Create sql/seed_country_iso.sql from ISO 3166-1 + ITU MID data
# psql $DATABASE_URL -f sql/seed_country_iso.sql
```

**FAO gear types** (60+ gear codes):

```bash
# TODO: Create sql/seed_gear_types_fao.sql from FAO ISSCFG
# psql $DATABASE_URL -f sql/seed_gear_types_fao.sql
```

**ASFIS species** (12,000+ species):

```bash
# TODO: Create sql/seed_harmonized_species.sql from FAO ASFIS
# psql $DATABASE_URL -f sql/seed_harmonized_species.sql
```

---

### 3. Test End-to-End Flow

**CSV ingestion test:**

```bash
# Place test CSV in watched directory
cp data/raw/vessels/SEAFO_vessels_2025-08-26.csv /data/incoming/

# Monitor processing
psql $DATABASE_URL -c "SELECT * FROM stage.document_processing_log ORDER BY triggered_at DESC LIMIT 5;"

# Check extractions
psql $DATABASE_URL -c "SELECT document_id, column_name, raw_value, cleaned_value, confidence FROM stage.csv_extractions LIMIT 10;"

# Review queue (low confidence)
psql $DATABASE_URL -c "SELECT * FROM stage.v_review_queue LIMIT 10;"
```

**NER extraction test:**

```bash
# Test NER with db_mapping
curl -X POST http://localhost:8080/predict \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Vessel FU RONG YU 6668 (IMO 9074729) flagged to China",
    "task": "ner"
  }' | jq '.entities[] | {label, text, db_mapping}'

# Expected output includes db_mapping fields:
# {
#   "label": "VESSEL_NAME",
#   "text": "FU RONG YU 6668",
#   "db_mapping": {"table": "curated.vessels", "field": "vessel_name"}
# }
# {
#   "label": "IMO",
#   "text": "9074729",
#   "db_mapping": {"table": "curated.vessels", "field": "imo", "validator": "validate_imo"}
# }
# {
#   "label": "FLAG",
#   "text": "China",
#   "db_mapping": {"table": "curated.vessels", "field": "flag_country_id", "reference_table": "curated.country_iso"}
# }
```

---

## Rollback Procedure

### Rollback Migrations

```bash
# Option A: Restore from backup (clean rollback)
pg_restore --clean --if-exists --dbname=$DATABASE_URL oceanid_staging_pre_v3_*.dump

# Option B: Manual rollback (drop tables in reverse order)
psql $DATABASE_URL <<'SQL'
-- V6 rollback (drop typed columns, restore view)
ALTER TABLE curated.vessel_info
  DROP COLUMN IF EXISTS vessel_type,
  DROP COLUMN IF EXISTS build_year,
  DROP COLUMN IF EXISTS risk_level,
  DROP COLUMN IF EXISTS risk_score,
  DROP COLUMN IF EXISTS hull_material,
  DROP COLUMN IF EXISTS external_marking,
  DROP COLUMN IF EXISTS flag_registered_date,
  DROP COLUMN IF EXISTS vessel_engine_type,
  DROP COLUMN IF EXISTS vessel_fuel_type,
  DROP COLUMN IF EXISTS freezer_type;

-- V5 rollback (drop temporal tables)
DROP TABLE IF EXISTS curated.entity_confirmations CASCADE;
DROP TABLE IF EXISTS curated.entity_conflicts CASCADE;
DROP TABLE IF EXISTS curated.vessel_metrics CASCADE;
DROP TABLE IF EXISTS curated.vessel_associates CASCADE;
DROP TABLE IF EXISTS curated.vessel_sanctions CASCADE;
DROP TABLE IF EXISTS curated.vessel_authorizations CASCADE;
DROP TABLE IF EXISTS curated.vessel_flag_history CASCADE;

-- V4 rollback (drop reference tables)
DROP TABLE IF EXISTS curated.organization_types CASCADE;
DROP TABLE IF EXISTS curated.unit_types CASCADE;
DROP TABLE IF EXISTS curated.association_types CASCADE;
DROP TABLE IF EXISTS curated.sanction_types CASCADE;
DROP TABLE IF EXISTS curated.authorization_types CASCADE;
DROP TABLE IF EXISTS curated.ports CASCADE;
DROP TABLE IF EXISTS curated.harmonized_species CASCADE;
DROP TABLE IF EXISTS curated.gear_types_fao CASCADE;
DROP TABLE IF EXISTS curated.rfmos CASCADE;
DROP TABLE IF EXISTS curated.country_iso CASCADE;

-- V3 rollback (drop staging tables)
DROP TABLE IF EXISTS stage.promotion_log CASCADE;
DROP TABLE IF EXISTS stage.document_processing_log CASCADE;
DROP TABLE IF EXISTS stage.training_corpus CASCADE;
DROP TABLE IF EXISTS stage.csv_extractions CASCADE;
DROP TABLE IF EXISTS stage.cleaning_rules CASCADE;
SQL
```

---

## Monitoring & Observability

### Key Metrics

```sql
-- Migration status
SELECT version, description, installed_on, success
FROM flyway_schema_history
ORDER BY installed_rank DESC
LIMIT 10;

-- Table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname IN ('stage', 'curated')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Row counts
SELECT 'stage.cleaning_rules' AS table_name, COUNT(*) FROM stage.cleaning_rules
UNION ALL SELECT 'stage.csv_extractions', COUNT(*) FROM stage.csv_extractions
UNION ALL SELECT 'stage.training_corpus', COUNT(*) FROM stage.training_corpus
UNION ALL SELECT 'curated.rfmos', COUNT(*) FROM curated.rfmos
UNION ALL SELECT 'curated.country_iso', COUNT(*) FROM curated.country_iso
UNION ALL SELECT 'curated.vessel_authorizations', COUNT(*) FROM curated.vessel_authorizations
UNION ALL SELECT 'curated.vessel_sanctions', COUNT(*) FROM curated.vessel_sanctions;

-- Review queue depth (should be monitored continuously)
SELECT COUNT(*) AS needs_review FROM stage.v_review_queue;

-- Promotion lag (documents ready but not promoted)
SELECT COUNT(*) AS ready_to_promote FROM stage.v_auto_promotable;
```

---

## Troubleshooting

### Common Issues

**1. Extension not available**

```
ERROR: extension "postgis" is not available
```

**Fix:** Install PostGIS packages:

```bash
# Debian/Ubuntu
sudo apt-get install postgresql-14-postgis-3

# Red Hat/CentOS
sudo yum install postgis33_14

# macOS
brew install postgis
```

**2. Permission denied for extension**

```
ERROR: permission denied to create extension "pgcrypto"
```

**Fix:** Connect as superuser or request `rds_superuser` role (AWS RDS)

**3. Temporal exclusion constraint violation**

```
ERROR: conflicting key value violates exclusion constraint
```

**Fix:** Ensure no overlapping date ranges for same vessel in `vessel_flag_history`

**4. Foreign key violation**

```
ERROR: insert or update violates foreign key constraint
```

**Fix:** Seed reference tables before inserting dependent data

---

## Success Criteria

- ✅ All migrations V3-V6 applied successfully
- ✅ 5 staging tables created (cleaning_rules, csv_extractions, training_corpus, promotion_log, document_processing_log)
- ✅ 5 reference tables seeded (country_iso, rfmos, gear_types_fao, harmonized_species, ports)
- ✅ 7 temporal tables created (flag_history, authorizations, sanctions, associates, metrics, conflicts, confirmations)
- ✅ Typed columns added to vessel_info (10 new columns)
- ✅ 13 RFMOs seeded in curated.rfmos
- ✅ >5000 cleaning rules loaded
- ✅ All views return without errors
- ✅ Indices created (50+ indices across staging + curated)
- ✅ PostGIS geometry columns verified
- ✅ Temporal exclusion constraints active

---

## Next Steps

See **Issue #53** for Phase 0 implementation:

1. Wire `labels.json` into adapter/postprocessor
2. Remove 9-label silent fallback
3. Add fail-fast startup validation
4. Implement validators (IMO, MMSI, RFMO, ISO3166)
5. Enable `db_mapping` in adapter responses

---

**Deployment Status:** Ready ✅
**Estimated Deployment Time:** 30-45 minutes
**Risk Level:** Low (additive migrations, no data loss)
**Rollback Time:** <10 minutes (restore from backup)
