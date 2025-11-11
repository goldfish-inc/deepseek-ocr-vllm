Authorized Views (Org‑Scoped Access Control)
===========================================

Intent
------
Use per‑org views in MD as the primary authorization boundary. Parser‑based checks in ocean remain as defense‑in‑depth.

Naming
------
- curated.<dataset> — canonical view
- org_<orgid>_<dataset> — authorized view for a given org

Example Pattern
---------------
- org_123_vessel_events AS
  SELECT * FROM curated.vessel_events
  WHERE visibility = 'public' OR org_id = '123'
  -- optional plan gates: AND event_date >= now() - interval '90 days'

Management
----------
- Create/update views during ingestion or a separate grant job
- Update ocean.org_access with the authorized view names
- Catalog shows only authorized views for current org

Verification
------------
- ocean /api/query should reject raw table references
- MD returns data only when querying authorized views
