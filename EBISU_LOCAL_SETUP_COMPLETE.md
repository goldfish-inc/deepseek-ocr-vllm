# ✅ EBISU Local Setup - COMPLETE with AMD64 Platform

**Date:** 2025-11-06
**Status:** Ready for entity resolution

## What's Running

```
✅ PostgreSQL 17 with PostGIS  → localhost:5433 (AMD64)
✅ PostGraphile API            → http://localhost:5001/graphiql (AMD64)
✅ EBISU schema migrations     → V1-V12 applied
✅ 36,122 raw vessels loaded   → public.vessels
⏳ Entity resolution           → NOT run yet (curated.vessels empty)
```

## Platform Configuration

All containers now run with **explicit AMD64 platform** specification to ensure compatibility with cloud/VPS infrastructure:

```yaml
services:
  postgres:
    image: postgis/postgis:17-3.5
    platform: linux/amd64  # ← Ensures cloud compatibility

  postgraphile:
    image: graphile/postgraphile:latest
    platform: linux/amd64  # ← Ensures cloud compatibility
```

This eliminates architecture-specific compilation errors when deploying to production.

## EBISU Schema Status

### Schemas Created ✅
- **control**: Migration tracking and control tables
- **raw**: Raw ingestion data
- **stage**: Staging area for data processing
- **curated**: Canonical entities after EBISU entity resolution
- **label**: Label Studio integration (placeholder)

### Tables Created ✅
- **30 curated tables**: Including vessels, vessel_identifiers, vessel_info, vessel_associates, etc.
- **4 curated views**: vessels_enrichment_view, v_vessels_current_state, etc.

### Extensions Enabled ✅
- PostGIS (geospatial)
- pg_trgm (fuzzy search)
- unaccent (accent-insensitive search)
- btree_gist (temporal indexing)

## Available GraphQL Queries

PostGraphile now exposes **both public and curated schemas**:

### Current Data (Raw Vessels) - Works NOW

```graphql
query GetRawVessels {
  allRawVessels(first: 20, condition: { imo: "9086758" }) {
    totalCount
    nodes {
      entityId
      vesselName
      imo
      mmsi
      ircs
      vesselFlag
      rfmo
    }
  }
}
```

**Status:** ✅ Returns 36,122 vessels from public.vessels

### Future Data (Curated Vessels) - After Entity Resolution

```graphql
query GetCuratedVessels {
  allCuratedVessels(first: 20) {
    totalCount
    nodes {
      vesselId
      vesselName
      imo
      mmsi
      ircs
      createdAt
      updatedAt
    }
  }
}
```

**Status:** ⏳ Returns 0 vessels (needs entity resolution to populate curated.vessels)

### Search Function

```graphql
query SearchVessels {
  searchVessels(q: "PACIFIC", limitN: 10) {
    entityId
    vesselName
    imo
    mmsi
  }
}
```

**Status:** ✅ Works with fuzzy matching and accent-insensitive search

## Current Data Flow

```
MVP Parquet (36,122 records)
  ↓
public.vessels (raw data) ← You are here
  ↓
[EBISU Entity Resolution - NOT RUN YET]
  ↓
curated.vessels (canonical entities) ← Empty, needs processing
  ↓
PostGraphile GraphQL API
  ↓
@ocean UI Platform
```

## What's Missing

### To Get Entity-Resolved Data

The raw 36,122 vessel records need to be:
1. **Loaded into staging**: `stage.*` tables
2. **Processed by EBISU**: Entity resolution to merge duplicates
3. **Promoted to curated**: Creates canonical `curated.vessels`

This will reduce ~36k raw records → ~7,666 canonical vessel entities (based on unique IMOs).

### Commands to Run Entity Resolution

```bash
# Set environment for local DB
export CB_HOST=localhost
export CB_PORT=5433
export CB_USER=postgres
export CB_PASS=postgres
export CB_DB=vessels

# Load raw data into staging area
make cb.stage.load

# Run EBISU entity resolution
make cb.ebisu.process

# Verify curated vessels created
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d vessels \
  -c "SELECT COUNT(*) FROM curated.vessels;"
```

## GraphiQL Testing

Open http://localhost:5001/graphiql and try:

```graphql
{
  # Raw vessels (works now)
  allRawVessels(first: 5, condition: { rfmo: "ICCAT" }) {
    totalCount
    nodes {
      vesselName
      imo
      mmsi
      entityId
    }
  }

  # Curated vessels (empty until entity resolution runs)
  allCuratedVessels(first: 5) {
    totalCount
    nodes {
      vesselName
      imo
    }
  }
}
```

## For @ocean UI Team

### Use Raw Data NOW

```typescript
// src/lib/graphql-client.ts
const GRAPHQL_ENDPOINT = 'http://localhost:5001/graphql'

export async function searchVessels(criteria: {
  vesselName?: string
  imo?: string
  rfmo?: string
}) {
  const query = `
    query SearchRawVessels($condition: RawVesselCondition) {
      allRawVessels(first: 20, condition: $condition) {
        totalCount
        nodes {
          entityId
          vesselName
          imo
          mmsi
          ircs
          vesselFlag
          rfmo
        }
      }
    }
  `

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { condition: criteria } })
  })

  return response.json()
}
```

### Switch to Curated Data LATER

After entity resolution runs, update queries to use `allCuratedVessels` instead of `allRawVessels`.

## Docker Management

```bash
# Stop
docker-compose down

# Start
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f postgraphile

# Restart PostGraphile only
docker-compose restart postgraphile

# Rebuild with AMD64 platform
docker-compose build --platform linux/amd64
```

## Architecture Benefits

### AMD64 Platform Specification

✅ **Local Development**: Runs on Apple Silicon via Rosetta emulation
✅ **Cloud Deployment**: Matches AMD64 servers (no recompilation needed)
✅ **VPS Compatibility**: Works on DigitalOcean, AWS, GCP, etc.
✅ **Consistent Images**: Same binaries from dev → staging → production

### PostGIS Integration

✅ **Geospatial Queries**: Ready for future vessel location features
✅ **CrunchyBridge Match**: Same extensions as production database
✅ **Maritime Coordinates**: Supports lat/lon port and vessel positions

## Schema Intelligence

### Current State: Level 1 (Raw Data)
- 36,122 raw records
- Duplicates present (same vessel from multiple RFMOs)
- Basic identifiers only
- No historical tracking

### After Entity Resolution: Level 2 (Structured Intelligence)
- ~7,666 canonical vessels
- Duplicates merged
- Historical identifier changes tracked
- Collision detection enabled

### Future: Level 3+ (Risk Intelligence)
Requires additional data loads:
- IUU lists → `curated.vessel_watchlist_events`
- WRO enforcement → compliance tables
- Ownership data → `curated.vessel_associates`
- AIS tracking → movement tables

## Known Issues & Workarounds

### Issue: Both public.vessels and curated.vessels expose "Vessels" type

**Solution:** Added smart comments to rename GraphQL types:
- `public.vessels` → `RawVessel` type
- `curated.vessels` → `CuratedVessel` type

This prevents naming conflicts in PostGraphile.

### Issue: UI vessels view returns 0 records

**Expected:** The `allUiVessels` query maps to `curated.vessels` which is empty until entity resolution runs. Use `allRawVessels` for current data.

## Summary

✅ **Environment**: Local PostgreSQL 17 + PostGIS running on AMD64
✅ **Migrations**: EBISU schema V1-V12 applied successfully
✅ **Data**: 36,122 raw vessels loaded and queryable
✅ **API**: PostGraphile exposing both public (raw) and curated (empty) schemas
✅ **Platform**: Explicit AMD64 ensures cloud compatibility
⏳ **Next Step**: Run entity resolution to populate curated.vessels

## Quick Start Commands

```bash
# Test GraphQL endpoint
curl http://localhost:5001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ allRawVessels(first: 3) { totalCount } }"}'

# Check vessel count
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d vessels \
  -c "SELECT COUNT(*) FROM public.vessels;"

# View EBISU schemas
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d vessels \
  -c "\dn"

# Inspect GraphQL schema in browser
open http://localhost:5001/graphiql
```

Ready for UI development and entity resolution! 🚀
