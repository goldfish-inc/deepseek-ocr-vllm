# Customer vs Admin Features - Quick Reference

## What Customers See (@ocean Platform)

### ✅ Customer Features (Build in @ocean)

```
┌─────────────────────────────────────────┐
│  Ocean Platform (Customer-Facing)      │
│                                         │
│  🔍 Search Vessels                      │
│     - By name, IMO, MMSI, flag         │
│     - Fuzzy search, filters            │
│                                         │
│  📄 Vessel Details                      │
│     - Current information              │
│     - Historical names/flags           │
│     - Data sources (RFMO list)         │
│                                         │
│  ⭐ Saved Vessels                       │
│     - Bookmark vessels                 │
│     - Export to CSV/Excel              │
│                                         │
│  📊 User Dashboard                      │
│     - Their search history             │
│     - Saved items                      │
│     - Team activity                    │
│     - Subscription usage               │
│                                         │
│  👥 Account Management                  │
│     - Profile settings                 │
│     - Team members                     │
│     - Billing/invoices                 │
└─────────────────────────────────────────┘
```

**Data Source:** PostGraphile API (clean, validated data)

---

## What Admins See (@oceanid Internal Tools)

### ⚙️ Admin Features (Build in @oceanid/apps/admin-ui)

```
┌─────────────────────────────────────────┐
│  Oceanid Admin (Internal Only)         │
│                                         │
│  ⚠️ Collision Review Queue              │
│     - IMO/MMSI conflicts                │
│     - Choose/merge/reassign             │
│     - Resolution audit trail           │
│                                         │
│  📥 Ingestion Monitoring                │
│     - CSV/PDF uploads                   │
│     - Processing status                 │
│     - Error logs                        │
│                                         │
│  ✅ Data Quality Dashboard              │
│     - Confidence scores                 │
│     - Missing fields                    │
│     - Source reliability                │
│                                         │
│  🔧 Manual Fixes                        │
│     - Edit vessel records               │
│     - Merge duplicates                  │
│     - Bulk updates                      │
│                                         │
│  📊 Pipeline Metrics                    │
│     - Records processed                 │
│     - Entity resolution stats           │
│     - System health                     │
└─────────────────────────────────────────┘
```

**Data Source:** Direct PostgreSQL access (ebisu.*, stage.*, control.*)

---

## Side-by-Side Comparison

| Feature | Customer (@ocean) | Admin (@oceanid) |
|---------|-------------------|------------------|
| **Search vessels** | ✅ Clean results | ✅ + conflicts visible |
| **View vessel** | ✅ Current + history | ✅ + raw ingestion data |
| **Collision review** | ❌ Never see it | ✅ Review & resolve |
| **Data quality** | ❌ Not visible | ✅ Full metrics |
| **Edit vessels** | ❌ Read-only | ✅ Full CRUD |
| **Ingestion logs** | ❌ Not exposed | ✅ Full access |
| **Billing** | ✅ Their account | ❌ N/A |
| **Team management** | ✅ Their team | ❌ N/A |

---

## Example: IMO Collision

### What Happens (Backend @oceanid):

```
1. Ingest RFMO_ICCAT data
   → IMO 9123456 = "Pacific Tuna I"

2. Ingest RFMO_IOTC data
   → IMO 9123456 = "Atlantic Fisher"

3. EBISU detects collision
   → Creates ebisu.load_collisions record

4. Admin reviews in @oceanid admin UI
   → Decides: "Pacific Tuna I" is correct
   → Resolution: CHOOSE_EXISTING
   → "Atlantic Fisher" gets new IMO 9999999

5. Clean data published to PostGraphile
```

### What Customer Sees (Frontend @ocean):

```
Query: "Search for IMO 9123456"

Result:
{
  entityId: "abc-123",
  vesselName: "Pacific Tuna I",
  imo: "9123456",
  mmsi: "123456789",
  vesselFlag: "Panama"
}

✓ Clean data
✓ No collision visible
✓ Just works
```

**Customer never knows there was a conflict!**

---

## Where to Build What

### @ocean/src/routes/_auth/

```
dashboard/
  index.tsx              ✅ User's activity dashboard

vessels/
  search.tsx             ✅ Vessel search
  $id.tsx                ✅ Vessel detail page
  saved.tsx              ✅ User's bookmarks

settings/
  profile.tsx            ✅ User settings
  team.tsx               ✅ Team management
  billing.tsx            ✅ Subscription/billing

admin/
  collisions/            ❌ DON'T BUILD HERE!
```

### @oceanid/apps/admin-ui/src/routes/

```
collisions/
  index.tsx              ✅ Collision queue
  $queueId.tsx           ✅ Review specific collision

ingestion/
  index.tsx              ✅ Upload monitoring
  logs.tsx               ✅ Error logs

quality/
  dashboard.tsx          ✅ Data quality metrics
  sources.tsx            ✅ Source reliability
```

---

## API Access Patterns

### Customer API Calls (@ocean → PostGraphile)

```typescript
// Search vessels (customer feature)
const { data } = await fetch('http://postgraphile:5000/graphql', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${customerToken}`,  // Customer's token
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    query: `
      query SearchVessels($q: String!) {
        allUiVessels(condition: { vesselName: $q }) {
          nodes { entityId vesselName imo }
        }
      }
    `,
    variables: { q: 'Pacific' }
  })
})
```

### Admin API Calls (@oceanid/admin-ui → PostgreSQL)

```typescript
// Review collisions (internal admin feature)
import { sql } from '@vercel/postgres'

const collisions = await sql`
  SELECT * FROM ebisu.load_collisions
  WHERE status = 'NEW'
  ORDER BY detected_at DESC
`

// Direct database access, no PostGraphile
```

---

## Decision Tree: Where Does This Feature Go?

```
Is this feature for paying customers?
│
├─ YES → Build in @ocean
│   │
│   └─ Does it query vessel data?
│       │
│       ├─ YES → Use PostGraphile API
│       │        (clean data only)
│       │
│       └─ NO  → Use Supabase
│                (auth, billing, teams)
│
└─ NO  → Build in @oceanid/admin-ui
    │
    └─ Internal data operations
        - Collision review
        - Data quality
        - Ingestion monitoring
```

---

## Next Steps

1. **In @ocean:** Focus on customer vessel search/detail pages
2. **In @oceanid:** Build simple admin-ui for collision review
3. **PostGraphile:** Keep schema locked down (only expose clean views)

**Remember:** Customers pay for clean data, not data operations! 🎯
