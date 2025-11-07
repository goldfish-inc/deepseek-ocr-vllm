# EBISU Pipeline Workflows — Ingress and Egress

> Status: Source of truth for how we run the data pipeline, mapped 1:1 to code and CI.

## Environments & Prereqs
- Crunchy Bridge env vars (writer role): `CB_HOST`, `CB_PORT=5432`, `CB_USER`, `CB_PASS`, `CB_DB`
- Parquet artifact path (canonical): `PARQUET=path/to/vessels.parquet`
- One‑time Drizzle push for base schemas:
  ```bash
  cd sql/oceanid-ebisu-schema && pnpm run drizzle:push
  ```

## Ingress (Stage → Normalize → Views)
1) Stage Parquet → `stage.vessels_load`
   ```bash
   make cb.stage.load PARQUET=$PARQUET
   ```
   - Populates `stage.vessels_load` and ensures `stage.load_batches` has a batch row.

2) Normalize (core + history + provenance + collisions)
   ```bash
   make cb.ebisu.process
   ```
   - Applies `sql/ebisu_stage.sql` and `sql/ebisu_transform.sql`.
   - Runs `ebisu.process_vessel_load(<latest_batch_id>)`:
     - Upserts current: `ebisu.vessels`
     - Appends changes: `ebisu.vessel_reported_history`
     - Tracks provenance: `ebisu.vessel_sources`, `ebisu.vessel_source_identifiers`
     - Logs conflicts: `ebisu.load_collisions`

3) Views & Admin Objects (search/report/admin queue)
   ```bash
   make cb.schema
   ```
   - Applies `sql/vessels_lookup.sql` (extensions, GIN index, views, functions)
   - Applies `sql/ebisu_admin.sql` (collision review enums, table, view, lifecycle functions, selectors)

4) Quality Gates (fail on violations)
   ```bash
   make cb.test.schema
   ```
   - Runs `sql/tests/quality_assertions.sql`:
     - Table presence (`ebisu.vessels`, `ebisu.vessel_reported_history`, `stage.load_batches`, provenance tables)
     - Name empties threshold (≤ 60%)
     - IMO uniqueness + format; MMSI format warnings
     - FK integrity (history + provenance)
     - Admin objects presence (collisions + queue)

## Orchestration (GitHub Action)
- Manual reload: `.github/workflows/reload-ebisu.yml`
  - Steps: stage → normalize → views → gates
  - Summary includes counts and open collision reviews, plus top unresolved groups.

## Promotion Policy
- Promote read models (GraphQL) when quality gates pass. Collisions may exist; they appear in the reviewer queue and do not block publish.
- Data dictionary is the contract: `docs/ebisu-data-dictionary.md`.

## Egress (GraphQL, PostGraphile)
- Endpoint: `https://graph.boathou.se/graphql` (WAF: GET blocked, POST rate‑limited)
- Schemas exposed: `['public','ebisu']`
- Common queries
  - Search: `public.search_vessels(q, limitN)`
  - Report: `public.vessel_report(pEntityId)`
  - Admin (read): `public.ui_collision_review_queue`, helpers
- Admin mutations
  - `public.resolve_collision(idType, idValue, resolution, reviewer, notes)`
  - `public.ack_collision(idType, idValue, reviewer, notes)`
  - `public.dismiss_collision(idType, idValue, reviewer, notes, resolution)`
  - `public.reopen_collision(idType, idValue, reviewer, notes)`

## Observability
- Dashboards, alerts, and SLOs are moving to a separate observability project.
- This repo retains WAF controls and any base metrics endpoints required for health.

## Disaster Recovery (high‑level)
- Parquet is canonical and versioned (checksum). Re‑stage from artifact; re‑run normalize and gates.
- History (`ebisu.vessel_reported_history`) is append‑only; provenance tables are rebuildable from staging + source registry.

## Troubleshooting
- “No batch found”: ensure `make cb.stage.load` ran and `stage.load_batches` has a recent row.
- “Quality gates failed”: inspect notices in `sql/tests/quality_assertions.sql`; fix upstream data or ETL mapping.
- “GraphQL blocked”: WAF blocks GET; use POST; verify Zero Trust access and rate‑limit thresholds.

## Quick Copy/Paste
```bash
# One‑time schema push
cd sql/oceanid-ebisu-schema && pnpm run drizzle:push && cd -

# Environment (Crunchy writer)
export CB_HOST=... CB_PORT=5432 CB_USER=... CB_PASS=... CB_DB=postgres

# End‑to‑end refresh
make cb.ebisu.full PARQUET=data/mvp/vessels_mvp.parquet
make cb.test.schema

# Inspect queue
psql "postgresql://$CB_USER:$CB_PASS@$CB_HOST:$CB_PORT/$CB_DB?sslmode=require" -c \
  "select * from public.top_unresolved_collisions(5);"
```
