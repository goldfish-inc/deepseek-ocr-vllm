# ✅ UI Handoff - Vessel Intelligence System Ready

**Date:** 2025-11-06
**Status:** Phase 1 Complete - Intelligence-Aware Entity Resolution
**GraphQL API:** http://localhost:5001/graphiql

---

## What's Ready for @ocean UI NOW

### 📊 Data Summary

```
✅ 7,666 canonical vessels (deduplicated from 36,122 raw records)
✅ 18,086 source-attributed identifiers
✅ 9 intelligence red flags detected
✅ Multi-source provenance tracking
✅ Conflict detection operational
```

### 🎯 Available GraphQL Queries

#### 1. Browse Canonical Vessels

```graphql
query GetVessels {
  allCuratedVessels(first: 20) {
    totalCount
    nodes {
      vesselId
      imo
      vesselName
      mmsi
      ircs
      flagCode
      status
      createdAt
      updatedAt
    }
  }
}
```

**Returns:** Clean, deduplicated vessels

---

#### 2. Search Vessels (Fuzzy Matching)

```graphql
query SearchVessels($query: String!) {
  searchVessels(q: $query, limitN: 20) {
    entityId
    vesselName
    imo
    mmsi
    ircs
    createdAt
  }
}
```

**Variables:**
```json
{ "query": "PACIFIC" }
```

---

#### 3. Get Vessel Intelligence Dossier (Complete Profile)

```graphql
query GetVesselDossier($imo: String!) {
  allCuratedVessels(condition: { imo: $imo }) {
    nodes {
      vesselId
      imo
      vesselName
      mmsi
      ircs
      flagCode

      # All reported identifiers with sources
      vesselIdentifiersByVesselId {
        nodes {
          identifierType
          identifierValue
          confidence
          recordedAt
          metadata  # Contains source_rfmo, collision flags
        }
      }

      # Red flags and conflicts
      entityConflictsByEntityId(
        condition: { entityType: "VESSEL", resolved: false }
      ) {
        nodes {
          conflictType
          fieldName
          valueA
          valueB
          resolutionNotes
          detectedAt
        }
      }
    }
  }
}
```

**Variables:**
```json
{ "imo": "8347301" }
```

**Returns:**
```json
{
  "vessel_id": 11573,
  "imo": "8347301",
  "vessel_name": "Ryosei Maru No. 26",
  "identifiers": [
    {
      "type": "NAME",
      "value": "Ryosei Maru No. 26",
      "confidence": 0.7,
      "metadata": { "source_rfmo": "NPFC" }
    },
    {
      "type": "MMSI",
      "value": "431800172",
      "confidence": 0.3,
      "metadata": {
        "source_rfmo": "NPFC",
        "collision_detected": true
      }
    }
  ],
  "red_flags": [
    {
      "type": "MMSI_COLLISION",
      "field": "mmsi",
      "value_a": "431800172",
      "value_b": "431800172",
      "notes": "Same MMSI reported for multiple IMOs - potential identity fraud",
      "detected_at": "2025-11-07T04:19:10.531739+00:00"
    }
  ]
}
```

---

### 🚨 UI Components to Build

#### Component 1: Vessel Search
```typescript
// src/components/VesselSearch.tsx
import { searchVessels } from '@/lib/postgraphile'

export function VesselSearch() {
  const [results, setResults] = useState([])

  async function handleSearch(query: string) {
    const vessels = await searchVessels(query)
    setResults(vessels)
  }

  return (
    <div>
      <SearchInput onSearch={handleSearch} />
      <VesselResults vessels={results} />
    </div>
  )
}
```

---

#### Component 2: Vessel Detail Page with Intelligence

```typescript
// src/components/VesselDetail.tsx
import { getVesselDossier } from '@/lib/postgraphile'

export function VesselDetail({ imo }) {
  const dossier = useQuery(['vessel', imo], () => getVesselDossier(imo))

  return (
    <div>
      <VesselHeader vessel={dossier.vessel} />

      {/* Show red flags prominently */}
      {dossier.red_flags?.length > 0 && (
        <RedFlagAlert flags={dossier.red_flags} />
      )}

      {/* Source attribution */}
      <DataSourcesCard identifiers={dossier.identifiers} />

      {/* Confidence indicators */}
      <ConfidenceScores identifiers={dossier.identifiers} />
    </div>
  )
}
```

---

#### Component 3: Red Flag Indicator

```typescript
// src/components/RedFlagAlert.tsx

interface RedFlag {
  type: 'MMSI_COLLISION' | 'FLAG_CHANGE' | 'OWNERSHIP_CHANGE'
  field: string
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  notes: string
  detected_at: string
}

export function RedFlagAlert({ flags }: { flags: RedFlag[] }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Intelligence Alerts ({flags.length})</AlertTitle>
      <AlertDescription>
        {flags.map((flag, i) => (
          <div key={i} className="mt-2">
            <Badge variant="destructive">{flag.type}</Badge>
            <p className="text-sm mt-1">{flag.notes}</p>
            <p className="text-xs text-muted-foreground">
              Detected: {new Date(flag.detected_at).toLocaleDateString()}
            </p>
          </div>
        ))}
      </AlertDescription>
    </Alert>
  )
}
```

---

#### Component 4: Source Attribution Badge

```typescript
// src/components/SourceBadge.tsx

export function SourceBadge({
  value,
  source,
  confidence
}: {
  value: string
  source: string
  confidence: number
}) {
  const color = confidence > 0.7 ? 'green' : confidence > 0.4 ? 'yellow' : 'red'

  return (
    <div className="flex items-center gap-2">
      <span>{value}</span>
      <Badge variant={color}>
        {source} ({Math.round(confidence * 100)}%)
      </Badge>
    </div>
  )
}
```

---

### 📊 Data Quality to Communicate

**Be transparent with users about data quality:**

```typescript
// Example: Show completeness
function VesselCompleteness({ vessel }) {
  const completeness = {
    identifiers: [vessel.imo, vessel.mmsi, vessel.ircs].filter(Boolean).length / 3,
    ownership: 0, // Not yet populated
    compliance: 0, // Not yet populated
  }

  return (
    <Card>
      <CardHeader>Data Completeness</CardHeader>
      <CardContent>
        <Progress value={completeness.identifiers * 100} />
        <p className="text-sm text-muted-foreground">
          Identifiers: {Math.round(completeness.identifiers * 100)}%
        </p>
        <Alert variant="warning">
          <Info className="h-4 w-4" />
          <AlertDescription>
            Ownership and compliance data not yet available.
            Coming in Phase 2.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}
```

---

## 🔧 GraphQL Client Setup

```typescript
// src/lib/postgraphile.ts

const GRAPHQL_ENDPOINT = import.meta.env.VITE_GRAPHQL_ENDPOINT || 'http://localhost:5001/graphql'

async function fetchGraphQL<T>(query: string, variables?: any): Promise<T> {
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

export async function searchVessels(query: string) {
  const data = await fetchGraphQL<{ searchVessels: Vessel[] }>(
    `
    query SearchVessels($q: String!, $limit: Int!) {
      searchVessels(q: $q, limitN: $limit) {
        entityId
        vesselName
        imo
        mmsi
        ircs
      }
    }
    `,
    { q: query, limit: 20 }
  )
  return data.searchVessels
}

export async function getVesselDossier(imo: string) {
  const data = await fetchGraphQL(
    `
    query GetDossier($imo: String!) {
      allCuratedVessels(condition: { imo: $imo }) {
        nodes {
          vesselId
          imo
          vesselName
          mmsi
          ircs
          flagCode
          vesselIdentifiersByVesselId {
            nodes {
              identifierType
              identifierValue
              confidence
              metadata
            }
          }
          entityConflictsByEntityId(condition: { resolved: false }) {
            nodes {
              conflictType
              fieldName
              resolutionNotes
              detectedAt
            }
          }
        }
      }
    }
    `,
    { imo }
  )
  return data.allCuratedVessels.nodes[0]
}
```

---

## 🎨 UI/UX Recommendations

### 1. **Red Flags Should Be Prominent**
- Show alert banner at top of vessel detail page
- Use warning colors (red/orange)
- Explain WHY it's flagged in plain language

### 2. **Source Attribution Everywhere**
- Every data point should show where it came from
- Use tooltips: "Reported by NPFC on 2024-01-15"
- Indicate confidence with visual cues

### 3. **Data Completeness Indicators**
- Show progress bars for completeness
- Explain what's missing and why
- Set expectations for future data

### 4. **Conflict Visualization**
- Side-by-side comparison: "Source A says X, Source B says Y"
- Timeline view for changes
- Clear indication which value is currently used

### 5. **Intelligence Context**
- Don't just show "MMSI Collision" - explain it:
  > "This MMSI is also claimed by another vessel (IMO 2397005), which could indicate identity fraud, data error, or MMSI reuse."

---

## 📈 Intelligence Metrics Dashboard

Consider building an admin dashboard showing:

```typescript
// Intelligence Health Metrics
{
  "total_vessels": 7666,
  "vessels_with_multiple_sources": 568,
  "active_red_flags": 9,
  "red_flags_by_type": {
    "MMSI_COLLISION": 9,
    "FLAG_CHANGE": 0,
    "OWNERSHIP_CHANGE": 0
  },
  "data_quality": {
    "avg_identifier_confidence": 0.72,
    "vessels_with_high_confidence_imo": 7666,
    "vessels_with_high_confidence_mmsi": 678
  }
}
```

---

## 🚧 What's NOT Ready Yet (Communicate to Users)

**Phase 2 Coming Soon:**
- ❌ Historical timeline (name/flag changes over time)
- ❌ Ownership data (beneficial owners, operators)
- ❌ Compliance watchlists (IUU, sanctions, WRO)
- ❌ Risk scores (aggregated intelligence)
- ❌ AIS movement data

**Current Limitations to Communicate:**
- Ownership fields mostly empty (17% populated in raw data)
- No historical tracking yet (shows current state only)
- No external watchlist matches
- Red flags limited to identifier collisions

---

## 🎯 Success Criteria for Phase 1

**You can show users:**
- ✅ Vessel search with fuzzy matching
- ✅ Deduplicated vessel profiles
- ✅ Multi-source data attribution
- ✅ Intelligence red flags
- ✅ Confidence scores
- ✅ Data quality indicators

**Ready to ship Phase 1!** 🚀

---

## 📞 Next Steps

1. **Build vessel search component**
2. **Build vessel detail page with dossier view**
3. **Add red flag indicators**
4. **Show source attribution**
5. **Test with real data from GraphQL endpoint**

**GraphQL Playground:** http://localhost:5001/graphiql

All queries work NOW. Start building! 🎉
