# EBISU Production Implementation — Summary & Runbook

Scope: Normalized EBISU vessel model (core + history), provenance, batch staging, GraphQL (PostGraphile), and operational guardrails (WAF + monitoring).

## Architecture (production)
- Canonical: Parquet (non‑destructive; provenance preserved)
- Stage: `stage.vessels_load` (+ `stage.load_batches`)
- Normalize: `ebisu.vessels` (current), `ebisu.vessel_reported_history` (changes), provenance: `ebisu.vessel_sources`, `ebisu.vessel_source_identifiers`, registry: `ebisu.original_sources_vessels`
- Views/Functions (public): search + report over EBISU
- API: PostGraphile (schemas: `['public','ebisu']`)
- DB: Crunchy Bridge (TLS strict on hostname)
- Exposure: Cloudflare Tunnel (graph.boathou.se) with WAF/rate‑limit

## Quick Start (prod)
1) Drizzle migrations (one time)
- `cd sql/oceanid-ebisu-schema && pnpm run drizzle:push`

2) Crunchy env
- `export CB_HOST=<host> CB_PORT=5432 CB_USER=<writer> CB_PASS=<pass> CB_DB=postgres`

3) Pipeline
- `make cb.ebisu.full PARQUET=data/mvp/vessels_mvp.parquet`  # stage → normalize → views
- `make cb.test.schema`                                      # quality gates

4) GraphQL
- Endpoint: `https://graph.boathou.se/graphql`
- Examples:
  - `searchVessels(q:"TAISEI", limitN:10)` (fuzzy, trigram)
  - `vesselReport(pEntityId:"<uuid>")` (summary + history + provenance)

## Quality Gates (sql/tests/quality_assertions.sql)
- Presence: `ebisu.vessels`, `ebisu.vessel_reported_history`, `stage.load_batches`
- Names: ≤ 60% empty (current rows)
- Uniqueness: IMO no duplicates (double‑check beyond unique index)
- Format: IMO 7 digits; MMSI 9 digits (warnings)
- FKs: history and provenance tables reference valid vessels/sources
- Summary emitted (vessels/history/sources/vessel_sources/source_identifiers)

## Transform (sql/ebisu_transform.sql)
- Match rule: IMO → MMSI (fallback); create vessel if no match
- Update current values; insert history on NAME/IMO/MMSI/IRCS/FLAG changes
- Provenance:
  - `ebisu.vessel_sources`: (vessel_uuid, source_id, first_seen_date, last_seen_date, is_active)
  - `ebisu.vessel_source_identifiers`: per‑source identifiers (deduped)
- Collisions: `ebisu.load_collisions` (hard‑id conflicts) recorded per batch

## WAF + Observability
- WAF (cloud/src/index.ts):
  - Block GET /graphql; Rate limit POST /graphql 120 req/min per IP (ban)
- Observability (dashboards/alerts/SLOs): moving to a dedicated observability project (separate repo). This repo retains only base metrics endpoints and security controls (e.g., WAF).

## GH Action (manual)
- `.github/workflows/reload-ebisu.yml`
- Steps: stage → normalize → views → quality tests → summary counts
- Secrets: `CRUNCHY_BRIDGE_HOST/PORT/USER/PASSWORD/DATABASE`
 - Summary includes `open_collision_reviews` from `public.ui_collision_review_queue`

## Data Dictionary
- `docs/ebisu-data-dictionary.md` — EBISU schemas, lineage, fields, indexes, gates
- CI guard: PRs changing SQL/Drizzle must update dictionary

See Also
- Pipeline workflows (ingress/egress): `docs/EBISU_PIPELINE_WORKFLOWS.md`
- Collision Review UI RFC (separate project): `docs/RFC_UI_COLLISION_REVIEW.md`

## Validation (one pass)
- Load: `make cb.ebisu.full` → `make cb.test.schema`
- Check collisions: `SELECT * FROM ebisu.load_collisions ORDER BY detected_at DESC LIMIT 25;`
- WAF: GET blocked; POST rate‑limited via curl loop
- Prometheus: cloudflared target UP; alert triggers on scale‑down to 0

## Known Follow‑ups (tracked in issues)
- Reviewer queue for collisions (UI/admin) — base backend implemented here; UI will live in its own project
- Expand history (registry, CFR, more identifiers) when needed
- Observability project: GraphQL SLO p50/p95 + error rate panels and burn‑rate alerts
