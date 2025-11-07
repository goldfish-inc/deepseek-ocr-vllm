# Architecture Separation: Backend vs Frontend

**Created:** 2025-11-06
**Purpose:** Clear separation between @oceanid (data ops) and @ocean (customer platform)

## The Problem

Early AI/ML SME work created confusion about what belongs in the customer-facing platform vs internal data operations. Collision review, data quality checks, and entity resolution are **BACKEND OPERATIONS**, not customer features.

## Clear Separation

### @oceanid (Data Operations - Internal)

**Purpose:** Clean, validate, and maintain vessel intelligence data

**Responsibilities:**
- CSV/PDF ingestion
- Data cleaning and normalization
- Entity resolution (matching vessels across sources)
- **Collision detection** (IMO/MMSI conflicts)
- **Collision review** (internal admin workflow)
- Data quality monitoring
- EBISU schema maintenance
- PostGraphile API (data access layer)

**Users:**
- Internal data team
- SME reviewers (if Path A)
- DevOps/engineers

**NOT for customers!**

---

### @ocean (Customer Platform - External)

**Purpose:** Multi-tenant SaaS platform for maritime data consumers

**Responsibilities:**
- User authentication (Supabase)
- Organization management
- Billing/subscriptions (Stripe)
- **Customer-facing vessel search**
- **Customer-facing vessel detail pages**
- **Customer-facing dashboards** (their usage, their searches)
- User settings
- Team management

**Users:**
- Paying customers
- End users in organizations

**NOT for data operations!**

---

## What Collision Review Actually Is

**Collision = Data Quality Issue**

When EBISU ingests vessel data from multiple sources:
- IMO `9123456` appears for Vessel A (from RFMO_ICCAT)
- IMO `9123456` appears for Vessel B (from RFMO_IOTC)
- This is a **collision** - same unique ID, different vessels

**This is an INTERNAL data quality problem, not a customer feature.**

### Collision Workflow (INTERNAL ONLY)

```mermaid
graph TD
    A[Data Ingestion] -->|Detect Conflict| B[ebisu.load_collisions]
    B --> C{Admin Review}
    C -->|Choose Existing| D[Keep Vessel A, discard B]
    C -->|Reassign ID| E[Give Vessel B new IMO]
    C -->|Merge Entities| F[A and B are same vessel]
    C -->|Data Error| G[Dismiss as source error]
    D --> H[Clean Data Published]
    E --> H
    F --> H
    G --> H
    H --> I[PostGraphile API]
    I --> J[@ocean customer sees clean data]
```

**Key Point:** By the time data reaches @ocean customers via PostGraphile, collisions are **already resolved**. Customers see clean, validated vessel records.

---

## What @ocean Customers See

### ✅ Customer-Facing Features

**Vessel Search:**
```graphql
query SearchVessels($query: String!) {
  allUiVessels(condition: { vesselName: $query }) {
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

**Vessel Detail:**
```graphql
query VesselDetail($id: String!) {
  uiVesselReport(entityId: $id) {
    currentName
    currentImo
    currentMmsi
    names        # Historical names
    imos         # Historical IMOs
    rfmos        # Data sources
    historyCount
  }
}
```

**Customer Dashboard:**
- Their search history
- Saved vessels
- Team activity
- Subscription usage
- Billing information

**What they DON'T see:**
- ❌ Collision review queue
- ❌ Data quality metrics
- ❌ Ingestion logs
- ❌ Entity resolution details
- ❌ Source conflict information

---

## What @oceanid Admins See (Internal Tools)

### Option 1: Separate Admin Tool (Recommended)

Build admin UI in @oceanid itself:

```
oceanid/
├── apps/
│   ├── admin-ui/              # NEW - Internal admin dashboard
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── collisions/
│   │   │   │   ├── ingestion/
│   │   │   │   └── quality/
│   │   └── package.json
```

**Features:**
- Collision review queue
- Ingestion monitoring
- Data quality dashboards
- Manual entity fixes
- Source management

**Auth:** Simple HTTP Basic Auth or VPN-only access (internal use)

### Option 2: Protected Admin Section in @ocean

If you want admin tools in @ocean:

```typescript
// @ocean/src/routes/_auth/admin/
// Only accessible to users with role='admin'

// Check user role
if (user.role !== 'admin') {
  throw redirect('/dashboard')
}
```

**Pros:** Reuse @ocean auth/UI
**Cons:** Mixes internal ops with customer platform

---

## PostGraphile API Role

**PostGraphile is the DATA ACCESS LAYER** for @ocean customers.

It does NOT:
- ❌ Handle collisions (done in EBISU before data published)
- ❌ Expose collision tables to customers
- ❌ Show data quality issues

It DOES:
- ✅ Expose clean, validated vessel data
- ✅ Provide search/filter capabilities
- ✅ Show historical changes (names, IMOs, flags)
- ✅ Return aggregated intelligence reports

### Schema Exposure

**Exposed to customers (via PostGraphile):**
```sql
-- Read-only views with clean data
public.ui_vessels
public.ui_vessel_report
public.search_vessels(query text)
```

**NOT exposed to customers:**
```sql
-- Internal tables stay in ebisu schema
ebisu.load_collisions         -- Internal only
ebisu.vessel_reported_history -- Raw history (aggregated in ui_vessel_report)
stage.*                       -- Staging area
control.*                     -- Pipeline control
```

---

## Recommended Architecture

### Data Flow (Correct)

```
┌─────────────────────────────────────────────────────┐
│ @oceanid (Data Operations - INTERNAL)              │
│                                                     │
│  CSV/PDF → Clean → EBISU → Collision Detection     │
│                              ↓                      │
│                       Admin Reviews Collisions     │
│                              ↓                      │
│                       Resolve Conflicts            │
│                              ↓                      │
│                    Clean Data Published            │
│                              ↓                      │
│                    PostGraphile API                │
└──────────────────────┬──────────────────────────────┘
                       │
                       │ GraphQL (clean data only)
                       ↓
┌─────────────────────────────────────────────────────┐
│ @ocean (Customer Platform - EXTERNAL)              │
│                                                     │
│  Supabase Auth → Customer Dashboard                │
│                      ↓                              │
│              Vessel Search & Detail                │
│                      ↓                              │
│              User's Saved Vessels                  │
│                      ↓                              │
│              Billing & Team Management             │
└─────────────────────────────────────────────────────┘
```

### Component Ownership

| Component | Repo | Purpose | Users |
|-----------|------|---------|-------|
| Data Ingestion | @oceanid | Process raw data | Internal |
| Entity Resolution | @oceanid | Match vessels | Internal |
| Collision Review | @oceanid | Fix conflicts | Internal |
| EBISU Schema | @oceanid | Store intelligence | Internal |
| PostGraphile | @oceanid | Expose clean data | API |
| **Customer Auth** | @ocean | Login/signup | Customers |
| **Customer UI** | @ocean | Search vessels | Customers |
| **Billing** | @ocean | Subscriptions | Customers |
| **Dashboards** | @ocean | User activity | Customers |

---

## Action Items

### 1. Remove Collision UI from @ocean (if added)

If you started building collision review in @ocean, move it:

```bash
# Don't build this in @ocean
@ocean/src/routes/_auth/admin/collisions/  # ❌ WRONG PLACE

# Build it here instead
@oceanid/apps/admin-ui/src/routes/collisions/  # ✅ CORRECT
```

### 2. Define @ocean Customer Features

**What customers actually need:**
- [ ] Search vessels by name/IMO/MMSI
- [ ] View vessel details (current + history)
- [ ] Save/bookmark vessels
- [ ] Export vessel lists (CSV/Excel)
- [ ] Usage analytics (their searches, not data quality)

**What they DON'T need:**
- [ ] ❌ Collision review
- [ ] ❌ Data quality dashboards
- [ ] ❌ Ingestion monitoring
- [ ] ❌ Source conflict resolution

### 3. Build Simple Admin Tool in @oceanid

For internal collision review:

```bash
cd /Users/rt/Developer/oceanid
mkdir -p apps/admin-ui
cd apps/admin-ui

# Simple Next.js or SvelteKit app
pnpm create next-app . --typescript
# or
pnpm create svelte .

# Add collision review routes
# No fancy auth - just HTTP Basic or VPN
```

### 4. Update PostGraphile Schema

Ensure only clean views are exposed:

```sql
-- Revoke access to internal tables
REVOKE ALL ON ebisu.load_collisions FROM vessels_ro;
REVOKE ALL ON ebisu.vessel_reported_history FROM vessels_ro;

-- Grant access only to clean views
GRANT SELECT ON public.ui_vessels TO vessels_ro;
GRANT SELECT ON public.ui_vessel_report TO vessels_ro;
GRANT EXECUTE ON FUNCTION public.search_vessels TO vessels_ro;
```

---

## Summary

**The Mistake:**
Mixing internal data operations (collision review, data quality) with customer features (search, dashboards).

**The Fix:**
1. @oceanid handles all data ops INTERNALLY
2. @ocean consumes clean data via PostGraphile
3. Customers never see collisions - they're resolved before publication
4. Admin tools (collision review) stay in @oceanid, not @ocean

**Remember:**
- **@oceanid = kitchen** (data prep, quality control)
- **@ocean = restaurant** (serving clean data to customers)

Customers don't need to see how the sausage is made! 🍴
