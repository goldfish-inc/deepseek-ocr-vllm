# EBISU Normalization & History — Project Plan

Goal: Implement a normalized `ebisu` data model with SCD‑2 history, fed by a Parquet canonical pipeline, served via PostGraphile/Crunchy, with robust validation and ops.

Project Structure
- Board: GitHub Project “EBISU Normalization & History” with columns Backlog → Ready → In Progress → Review → Done.
- Labels: `ebisu`, `etl`, `schema`, `graphql`, `ops`, `observability`, `security`, `quality`, `performance`.
- Issue Template: `.github/ISSUE_TEMPLATE/ebisu_story.yml` (required Validation section).

Milestones
- M1 Foundation (schema + stage)
- M2 ETL & History (SCD‑2)
- M3 API & Views
- M4 Operations & Security
- M5 Observability & SLOs
- M6 Data Quality & Governance
- M7 DX & Automation

Backlog of Stories (create one issue per item)

1) Define stage schema + batch tracking (M1)
- Deliverables:
  - `sql/ebisu_stage.sql` (stage.vessels_load, stage.load_batches)
  - Make target `cb.stage.load`
- Validation:
  - psql: stage tables exist; `batch_id` default UUID; FK from load table to batches.

2) EBISU vessel domain tables in Drizzle (M1)
- Deliverables:
  - `sql/oceanid-ebisu-schema/drizzle-schemas/ebisu/*.ts` for vessels, vessel_identifiers, vessel_names, vessel_flags, vessel_rfmo_records
  - Generated migration in `sql/oceanid-ebisu-schema/migrations/`
- Validation:
  - `pnpm -C sql/oceanid-ebisu-schema run drizzle:generate && drizzle:push` (dev DB)
  - `make cb.test.schema` checks tables, PK/FK, indexes present.

3) SQL transform — process_vessel_load(batch_id) (M2)
- Deliverables:
  - `sql/ebisu_transform.sql` with SCD‑2 upsert logic; `ebisu.load_audit`
  - Make target `cb.ebisu.process`
- Validation:
  - Load two synthetic batches → names/flags/identifiers close/open correctly.
  - Query returns 0 “overlapping versions”.

4) Loader to stage (batch-aware) (M2)
- Deliverables:
  - `scripts/load_supabase.py` `--stage` to write into `stage.vessels_load` with batch_id
  - Make target `cb.ebisu.full` (stage → process → views → grants)
- Validation:
  - `make cb.ebisu.full` succeeds; audit rows show non-zero upserts; thresholds met.

5) EBISU UI views & GraphQL helpers (M3)
- Deliverables:
  - `sql/vessels_lookup.sql` rebuilt over `ebisu.*` tables (search_vessels, vessel_report, ui_entity_summary, ui_vessel_conflicts)
- Validation:
  - GraphQL queries return same shapes; 3 canned queries pass.

6) PostGraphile expose `ebisu` schema (M3)
- Deliverables:
  - `apps/postgraphile/server.js` uses schemas `['public','ebisu']`
- Validation:
  - Introspection shows `ebisu` types; report query works.

7) WAF / Rate limit for /graphql (M4)
- Deliverables:
  - Pulumi Cloudflare rule for POST /graphql per-IP throttling
- Validation:
  - Load-test curl script triggers rate limit; normal traffic passes.

8) Tunnel observability + alert (M5)
- Deliverables:
  - ServiceMonitor for cloudflared metrics; Prometheus alert on `cloudflared_tunnel_connected`
- Validation:
  - Alert fires on forced disconnect; dashboard shows healthy when restored.

9) Data quality gates (M6)
- Deliverables:
  - `sql/tests/quality_assertions.sql` with thresholds (<= X% empty names; MMSI format checks; distinct entities)
  - CI step in GH Action to run assertions before promote
- Validation:
  - Fails on poor inputs; passes on known-good Parquet.

10) SLOs for GraphQL (M5)
- Deliverables:
  - Defined SLOs (p50/p95 latency, error rate) and Grafana dashboards
- Validation:
  - Synthetic canaries tracked; alerts configured.

11) DX: GH Action “Reload EBISU” (M7)
- Deliverables:
  - `.github/workflows/reload-ebisu.yml` with manual dispatch; uses CB_* secrets
- Validation:
  - Dry-run pipeline runs in staging, publishes a quality report summary.

12) Governance: Data dictionary & lineage (M6)
- Deliverables:
  - `docs/ebisu-data-dictionary.md` (tables, columns, provenance, retention)
- Validation:
  - Lint check ensures dictionary updated when schema changes.

Startup Validation Cheatsheet
- Parquet QA (local):
  - `duckdb -c "SELECT COUNT(*) rows, SUM((coalesce(vessel_name,'')='')::INT) name_empty FROM read_parquet('data/mvp/vessels_mvp.parquet');"`
- Stage Load:
  - `make cb.stage.load` (with CB_* env)
- Normalize:
  - `make cb.ebisu.process`
- Views/Functions:
  - `psql … -f sql/vessels_lookup.sql`
- Grants:
  - `make cb.grants VESSELS_RO=vessels_ro`
- GraphQL:
  - `curl -s -X POST https://graph.boathou.se/graphql -H 'content-type: application/json' -d '{"query":"{__schema{queryType{name}}}"}'`
