# PostGraphile Contract for @ocean UI

**Generated:** 2025-11-06
**Endpoint:** http://localhost:5001/graphql
**Database:** PostgreSQL 17.6 @ localhost:5433/vessels

## What's Available NOW

### Current Schema Status

✅ **Working:**
- Query: `allVessels`
- Type: `Vessel`
- Table: `public.vessels` (36,122 rows from MVP parquet)

❌ **NOT Available Yet:**
- `ui_vessels` view (needs EBISU migrations)
- `ui_vessel_report` view (needs EBISU migrations)
- `vessel_associates` table (ownership data)
- `vessels_iuu_simple` table (compliance)
- `vessels_outlaw_ocean` table (compliance)
- `wro_enforcement` table (compliance)
- `vessel_info` table (physical specs)
- `vessel_metrics` table (dimensions)

### Available Fields on `Vessel` Type

**Core Identification (Available):**
```graphql
type Vessel {
  vesselName: String
  imo: String
  mmsi: String
  ircs: String              # Call sign
  vesselFlag: String
  entityId: String
  rfmo: String              # Data source
}
```

**Additional Fields from Raw Data:**
- 200+ RFMO-specific columns (camelCased)
- Owner/operator fields exist but sparse
- Authorization fields (dates, numbers)
- Technical specs (beam, tonnage - if present in source data)

## Your UI → PostGraphile Mapping

### Search Query (Working Example)

```graphql
query SearchVessels(
  $vesselName: String
  $imo: String
  $mmsi: String
  $ircs: String
  $vesselFlag: String
) {
  allVessels(
    first: 20
    condition: {
      vesselName: $vesselName
      imo: $imo
      mmsi: $mmsi
      ircs: $ircs
      vesselFlag: $vesselFlag
    }
  ) {
    totalCount
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
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

**Status:** ✅ This works NOW with current data!

### Detail Query (Current State)

```graphql
query GetVesselDetail($entityId: String!) {
  allVessels(condition: { entityId: $entityId }) {
    nodes {
      # Core identification
      vesselName
      imo
      mmsi
      ircs
      vesselFlag
      entityId
      rfmo

      # Owner fields (if populated)
      addressOfTheOwnerOrOwners
      beneficialOwner
      beneficialOwnerAddress
      addressOfCharterer

      # Authorization
      authorisationStartDate
      authorisationEndDate
      authorised
      authorisingEntity

      # Technical (sparse)
      beam
      beamM
      # Note: Most vessels won't have these filled
    }
  }
}
```

**Status:** 🟡 Works but very sparse data (most fields empty)

## What Your UI Expects vs Reality

### ✅ Available NOW (Ready to Use)

| UI Field | GraphQL Field | Data Quality |
|----------|---------------|--------------|
| Vessel Name | `vesselName` | ~17% populated |
| IMO | `imo` | ~35% populated |
| MMSI | `mmsi` | ~5% populated |
| Call Sign | `ircs` | Unknown (check) |
| Flag | `vesselFlag` | Sparse |
| Entity ID | `entityId` | 100% |
| Source | `rfmo` | 100% (11 RFMOs) |

### ❌ NOT Available (Need EBISU Schema)

| UI Field | Needs | Table/View |
|----------|-------|------------|
| IUU Status | ❌ | `vessels_iuu_simple` |
| WRO Status | ❌ | `wro_enforcement` |
| Outlaw Ocean | ❌ | `vessels_outlaw_ocean` |
| Owner | 🟡 Sparse | `vessel_associates` (not loaded) |
| Operator | ❌ | `vessel_associates` |
| Captain | ❌ | `vessel_associates` |
| Builder | ❌ | `vessel_associates` |
| Vessel Type | ❌ | `vessel_types` lookup |
| Country Flag | ❌ | `country_iso` lookup |
| Tonnage | 🟡 Sparse | Current data |
| Length | 🟡 Sparse | `vessel_info` |
| Width | 🟡 Sparse | `vessel_info` |
| Previous Names | ❌ | `ui_vessel_report` view |
| Previous Flags | ❌ | `ui_vessel_report` view |

## Recommended Approach for @ocean

### Phase 1: MVP with Current Data (Do This Now)

Use what's available:

```typescript
// src/lib/postgraphile-client.ts

export interface VesselBasic {
  entityId: string
  vesselName: string | null
  imo: string | null
  mmsi: string | null
  ircs: string | null
  vesselFlag: string | null
  rfmo: string
}

export async function searchVessels(criteria: {
  vesselName?: string
  imo?: string
  mmsi?: string
  ircs?: string
  vesselFlag?: string
}): Promise<VesselBasic[]> {
  const query = `
    query SearchVessels($condition: VesselCondition) {
      allVessels(first: 20, condition: $condition) {
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

  const response = await fetch('http://localhost:5001/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { condition: criteria }
    })
  })

  const { data } = await response.json()
  return data.allVessels.nodes
}
```

**This works TODAY!**

### Phase 2: Enhanced Data (After EBISU Migration)

Once you run EBISU migrations:

1. Apply migrations: `V1-V12` in `sql/migrations/`
2. Apply views: `sql/vessels_lookup.sql`
3. Schema will include:
   - `ui_vessels` (clean view)
   - `ui_vessel_report` (with history)
   - Search functions
   - EBISU entity resolution

Then update queries to use `ui_vessel_report`:

```graphql
query GetVesselEnhanced($entityId: String!) {
  uiVesselReport(entityId: $entityId) {
    currentName
    currentImo
    currentMmsi
    currentIrcs
    names          # Historical names array
    imos           # Historical IMOs array
    mmsis          # Historical MMSI array
    rfmos          # All sources array
    historyCount
    nameChangeCount
    imoChangeCount
    hasImoConflict
    hasMmsiConflict
  }
}
```

## Quick Start for @ocean UI

### 1. Update Your PostGraphile Client

```typescript
// src/lib/postgraphile-client.ts

const GRAPHQL_ENDPOINT = import.meta.env.VITE_GRAPHQL_ENDPOINT || 'http://localhost:5001/graphql'

export async function fetchGraphQL<T>(query: string, variables?: any): Promise<T> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })

  const { data, errors } = await response.json()

  if (errors) {
    console.error('GraphQL errors:', errors)
    throw new Error(errors[0].message)
  }

  return data
}
```

### 2. Test Query in Browser Console

```javascript
// Open http://localhost:5001/graphiql and paste:

query TestSearch {
  allVessels(
    first: 10
    condition: { rfmo: "ICCAT" }
  ) {
    totalCount
    nodes {
      vesselName
      imo
      mmsi
      ircs
      vesselFlag
      entityId
      rfmo
    }
  }
}
```

### 3. Update Your .env.local

```bash
# @ocean/.env.local
VITE_GRAPHQL_ENDPOINT=http://localhost:5001/graphql
```

## Field Mapping Reference

### SQL Column → GraphQL Field

PostGraphile converts snake_case → camelCase:

| SQL Column | GraphQL Field |
|------------|---------------|
| `vessel_name` | `vesselName` |
| `vessel_flag` | `vesselFlag` |
| `entity_id` | `entityId` |
| `address_of_the_owner_or_owners` | `addressOfTheOwnerOrOwners` |

### Filter Conditions

Use `condition` parameter:

```graphql
allVessels(
  first: 20
  condition: {
    vesselName: "PACIFIC"
    rfmo: "ICCAT"
  }
)
```

**Operators:**
- Exact match: `{ imo: "9086758" }`
- Partial match: Use `filter` (if enabled)
- Multiple: Combine in `condition`

## Testing Checklist

- [ ] GraphiQL opens: http://localhost:5001/graphiql
- [ ] Search by IMO works
- [ ] Search by vessel name works
- [ ] Filter by RFMO works
- [ ] Results return expected fields
- [ ] Pagination info present
- [ ] Handle null/empty values

## Known Limitations

1. **Sparse Data:**
   - Most fields empty (depends on source RFMO)
   - Only 35% have IMO
   - Only 5% have MMSI
   - Only 17% have vessel names

2. **No Historical Data Yet:**
   - Previous names/flags require EBISU views
   - No change tracking without migrations

3. **No Compliance Data:**
   - IUU/WRO/Outlaw Ocean require separate tables
   - Not in MVP parquet dataset

4. **No Ownership Links:**
   - `vessel_associates` table not loaded
   - Owner fields sparse in raw data

## Next Steps

### For Immediate UI Development

1. ✅ Use `allVessels` query
2. ✅ Core fields: name, IMO, MMSI, call sign, flag, entity ID
3. ✅ Display RFMO source
4. ✅ Handle sparse/null data gracefully
5. ✅ Show "Data not available" for missing fields

### For Production-Ready (Later)

1. Apply EBISU migrations in @oceanid
2. Use `ui_vessels` and `ui_vessel_report` views
3. Add compliance table loads
4. Load vessel associations
5. Enable search functions (fuzzy matching)

## Summary

**What works NOW:** Basic vessel search with core identification fields
**What's missing:** Historical data, compliance flags, ownership, enhanced views
**Recommendation:** Build MVP UI with current data, enhance after EBISU migration

Your UI is ready - just adjust queries to match available fields! 🚀
