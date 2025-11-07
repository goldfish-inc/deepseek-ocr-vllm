# MVP Data Stack Workplan (Staged)

Scope: Deliver a single, queryable vessel dataset for a live demo (tomorrow), with fast analytics and GraphQL-ready lookups. Preserve every source row and provenance; no destructive merging.

Repo: Use this repo for speed (scripts + docs are already here). We can split later if needed.

Current Status (MVP)
- Stage 1: Complete — Parquet built at `data/mvp/vessels_mvp.parquet` (36,122 rows; provenance preserved)
- Stage 2: Complete — DuckDB view + snapshot created; MotherDuck optional
- Stage 3B: Complete — Supabase `public.vessels` loaded; indexes, extensions, and UI views created
- Next: UI lookup integration (routes/hooks) in ocean repo; canned queries and monitoring

---

## Scope Spotlight — Parquet → DuckDB (MVP)

Goal: Build one canonical Parquet from baselines (and OCR PDFs), then stand up DuckDB for fast analytics with zero schema work or destructive merges.

Data Flow

```mermaid
flowchart LR
  subgraph Ingestion
    CSV[CSV registries] --> BLD[Builder\n(mvp_build_dataset.py)]
    PDF[PDFs\nDeepseekOCR] --> MAP[Map to unified rows]
    MAP --> BLD
  end

  BLD --> PQ[(Parquet\n data/mvp/vessels_mvp.parquet)]

  PQ -->|live view| DVIEW{{DuckDB VIEW\n app.vessels}}
  PQ -->|snapshot| DDB[(DuckDB DB\n data/mvp/vessels.duckdb)] -->|CTAS| DTBL{{DuckDB TABLE\n app.vessels}}

  %% Optional serving later
  DTBL -.->|CTAS| PG[(Postgres)] -.-> GQL[PostGraphile/REST]
```

Unified Row (non‑destructive)

```mermaid
classDiagram
  class vessel_row {
    RFMO : text
    SOURCE_FILE : text
    SOURCE_ROW : int
    JOIN_KEY : text  %% e.g., IMO when present
    COMPOSITE_KEY : text
    ENTITY_ID : text %% JK: / CK: / ROW:*
    IMO : text
    MMSI : text
    IRCS : text
    VESSEL_NAME : text
    ... other source columns (text)
  }
```

CLI (no schema work):
- Build Parquet: `make parquet`
- DuckDB View: `duckdb -c "CREATE OR REPLACE VIEW app.vessels AS SELECT * FROM read_parquet('data/mvp/vessels_mvp.parquet');"`
- DuckDB Snapshot DB: `duckdb data/mvp/vessels.duckdb -c "CREATE OR REPLACE TABLE app.vessels AS SELECT * FROM read_parquet('data/mvp/vessels_mvp.parquet');"`

Assertions:
- All rows preserved (no merges); provenance columns present (RFMO, SOURCE_FILE, SOURCE_ROW)
- Identity keys present (JOIN_KEY, COMPOSITE_KEY, ENTITY_ID)

---

## Stage 0 — Inputs and Unified Parquet Shape

Sources
- CSV registries (existing baselines)
- PDFs (DeepseekOCR extraction)
 - Original CSVs location: `data/raw/vessels/RFMO/raw`

Unified Parquet shape (non-destructive)
- Provenance: `RFMO`, `SOURCE_FILE`, `SOURCE_ROW`
- Identity keys: `JOIN_KEY` (e.g., IMO when present), `COMPOSITE_KEY` (first complete set), `ENTITY_ID` (label to group, not a merge)
- Identifiers/attributes as-is: e.g., `IMO`, `MMSI`, `IRCS`, `VESSEL_NAME`, …
- Optional: `SOURCE_TYPE` (e.g., `csv` | `pdf`) if combining streams

Policy
- Keep original cell values intact (Unicode NFC for consistency only)
- No destructive merging; conflicts remain visible in the data

---

## Stage 1 — Build Dataset (Parquet as source-of-truth)

Goal: Produce one Parquet file with all rows + provenance and non-destructive identity keys.

Commands (two source paths):
- Path A (baselines, default):
  - `python scripts/mvp_build_dataset.py --parquet data/mvp/vessels_mvp.parquet`
- Path B (original CSVs):
  - `python scripts/mvp_build_dataset.py --in-dir data/raw/vessels/RFMO/raw --parquet data/mvp/vessels_mvp.parquet`

Output Columns (key subset):
- `RFMO`, `SOURCE_FILE`, `SOURCE_ROW` (provenance)
- `JOIN_KEY` (e.g., IMO), `COMPOSITE_KEY`, `ENTITY_ID` (label to group; non-destructive)
- All original source columns (e.g., `IMO`, `MMSI`, `VESSEL_NAME`, ...)

Acceptance:
- Parquet exists at `data/mvp/vessels_mvp.parquet`
- Row count equals sum of all baseline rows; values unchanged

---

## Stage 2 — Datastores

Targets
- Dev: Local Postgres 17.6 (Docker) for component development
- Serving (MVP): Supabase Postgres (managed Postgres; integrates with your backend/middleware)
- Analytics: MotherDuck (DuckDB in the cloud) for fast, shareable analytics
- Scale later: CrunchyBridge Postgres 17.6 (optional when you need bigger/more control)

Secrets (MotherDuck)
- Token managed in 1Password: item uuid `u7qpujh2bjhpiscpvxvofcol6y` in vault uuid `ddqqn2cxmgi4xl4rris4mztwea`.
- Load via `op` CLI (example):
  - `export MOTHERDUCK_TOKEN=$(op item get u7qpujh2bjhpiscpvxvofcol6y --vault ddqqn2cxmgi4xl4rris4mztwea --field token)`

### 2A — MotherDuck (analytics)

Load Parquet (DuckDB client):
- `duckdb`
- `INSTALL motherduck; LOAD motherduck;`
- `SET motherduck_token='${MOTHERDUCK_TOKEN}';`
- `ATTACH 'md:vessels_demo' AS md (READ_ONLY false);`
- `CREATE OR REPLACE TABLE md.vessels AS SELECT * FROM read_parquet('data/mvp/vessels_mvp.parquet');`
- `SELECT COUNT(*) FROM md.vessels;`

Optional: union PDF extractions
- `CREATE OR REPLACE TABLE md.vessels AS`
  `SELECT 'csv'::VARCHAR AS source_type, * FROM read_parquet('data/mvp/vessels_mvp.parquet')`
  `UNION ALL`
  `SELECT 'pdf'::VARCHAR AS source_type, * FROM read_parquet('data/mvp/vessels_pdf.parquet');`

### 2B — Local Postgres 17.6 (dev)

Goal: Stand up PG 17.6 in Docker and load the dataset without CSV roundtrips.

Start DB:
- `docker run --name vessels-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vessels -p 5432:5432 -d postgres:17.6`

Load Parquet via DuckDB (no CSV):
- `duckdb -c "INSTALL postgres; LOAD postgres; ATTACH 'pg' (TYPE POSTGRES, HOST '127.0.0.1', PORT 5432, USER 'postgres', PASSWORD 'postgres', DATABASE 'vessels'); CREATE TABLE pg.vessels AS SELECT * FROM read_parquet('data/mvp/vessels_mvp.parquet');"`

Indexes:
- `docker exec -i vessels-db psql -U postgres -d vessels -c "ALTER TABLE vessels ADD COLUMN id bigserial PRIMARY KEY; CREATE INDEX ON vessels(entity_id); CREATE INDEX ON vessels(imo); CREATE INDEX ON vessels(mmsi);"`

Acceptance:
- `SELECT COUNT(*) FROM vessels;` returns expected row count
- Basic lookups run < 100ms on indexed fields for small result sets

---

### 2C — CrunchyBridge Postgres 17.6 (optional, scale later)

Load MotherDuck → CrunchyBridge directly (in DuckDB):
- `duckdb`
- `INSTALL motherduck; LOAD motherduck; SET motherduck_token='${MOTHERDUCK_TOKEN}'; ATTACH 'md:vessels_demo' AS md;`
- `INSTALL postgres; LOAD postgres;`
- `ATTACH 'pg' (TYPE POSTGRES, HOST '<cb-host>', PORT 5432, USER '<cb-user>', PASSWORD '<cb-pass>', DATABASE '<cb-db>');`
- `CREATE OR REPLACE TABLE pg.vessels AS SELECT * FROM md.vessels;`

Then add PK + indexes in CrunchyBridge as in 2B.

---

## Stage 3 — GraphQL (PostGraphile, zero-schema work)

Goal: Expose GraphQL for UI components without writing resolvers.

Run:
- `docker run --rm -p 5000:5000 --network host graphile/postgraphile --connection postgres://postgres:postgres@localhost:5432/vessels --schema public --enhance-graphiql`

Sample Queries:
- All rows for an entity: `allVessels(filter: { entityId: { equalTo: "JK:9301234" } }) { nodes { rfmo sourceFile sourceRow imo mmsi vesselName entityId } }`
- Distinct MMSIs for an IMO: create a PG view or filter in client (keep simple for MVP)

Acceptance:
- GraphiQL available at `http://localhost:5000/graphiql`
- UI components can query by `ENTITY_ID`, `IMO`, `MMSI`, `VESSEL_NAME`

Schema policy (avoid migrations for MVP)
- Use CTAS (create table as select) from Parquet/MotherDuck → Postgres to evolve shape
- Add only PK + indexes (and optional small UI views); PostGraphile introspects the live table

---

## Stage 3B — Supabase (app backend for MVP)

Goal: Load the Parquet dataset into Supabase Postgres quickly, without migrations. Lowercase columns for ergonomic API field names.

Make target:
- `make supabase.load` — requires `SUPABASE_PG` (e.g., `postgresql+psycopg2://postgres:<pass>@<host>:6543/postgres`)

What it does:
- Creates `public.vessels` from Parquet (CTAS; no migrations)
- Adds `id` PK + indexes on `entity_id`, `imo`, `mmsi`, and trigram index on `vessel_name`
- Enables extensions (if allowed): `pg_trgm`, `unaccent` (accents preserved in data; used only for search)
- Creates UI views: `public.ui_entity_summary`, `public.ui_vessel_conflicts`
- Optional RPC for fuzzy search: `search_vessels(q text, limit_n int)` (see `sql/vessels_lookup.sql`)

Frontend queries (supabase-js):
- Select by entity:
  `select('entity_id, imo, mmsi, vessel_name, rfmo, source_file, source_row').eq('entity_id','JK:9301234').limit(50)`

Acceptance:
- `SELECT COUNT(*) FROM public.vessels;` matches Parquet row count
- `SELECT COUNT(*) FROM public.ui_entity_summary;` > 0
- `SELECT COUNT(*) FROM public.ui_vessel_conflicts;` returns rows
- `SELECT * FROM public.search_vessels('VALMITAO', 10);` returns ordered fuzzy matches


---

## Stage 4 — Conflict Surfacing (non-destructive)

Goal: Show identifier conflicts (e.g., same IMO with multiple MMSIs) without merging.

Simple SQL view (optional):
- `CREATE VIEW vessel_conflicts AS SELECT imo, array_agg(DISTINCT mmsi) AS mmsis, COUNT(DISTINCT mmsi) AS mmsi_count FROM vessels WHERE COALESCE(imo,'') <> '' AND COALESCE(mmsi,'') <> '' GROUP BY imo HAVING COUNT(DISTINCT mmsi) > 1;`

Acceptance:
- Query returns known conflicts; each row links back to source via `RFMO/SOURCE_FILE/SOURCE_ROW`

---

## Stage 5 — Analytics (DuckDB over Parquet)

Goal: Fast local analytics w/o DB imports.

Examples:
- `duckdb -c "SELECT entity_id, COUNT(*) FROM read_parquet('data/mvp/vessels_mvp.parquet') GROUP BY 1 ORDER BY 2 DESC LIMIT 20;"`

Acceptance:
- Aggregations scan quickly; can iterate queries during demo

---

## Stage 6 — Demo Prep & Guardrails

Checklist:
- [ ] Dataset built (Parquet)
- [ ] PG 17.6 running, table loaded, indexes added
- [ ] GraphQL endpoint up (PostGraphile)
- [ ] 3 canned queries for demo (by `ENTITY_ID`, by `IMO`, conflict example)
- [ ] Document commands in a short handoff (this file)

---

## Stage 7 — UI Integration (Vessels Lookup)

Repo: `goldfish-inc/ocean` (Vite + React 19 + TanStack Router/Query/Table)

Env (optional separate dataset project):
- `VITE_VESSELS_SUPABASE_URL`, `VITE_VESSELS_SUPABASE_PUBLISHABLE_KEY` (fallbacks to main client if unset)

Client wiring:
- Supabase client: `src/lib/supabase-vessels.ts` (optional dedicated client)
- Hooks: `src/features/vessels/hooks.ts` — `useVesselSearch(q)`, `useEntitySummary(id)`, `useEntityRows(id)`
- Routes: `/vessels/search` (search input + table), `/vessels/entity/:id` (summary + raw rows)
- Sidebar: “Vessels” link to `/vessels/search`

Server-side (dataset project):
- `sql/vessels_lookup.sql` — create `search_vessels` RPC; ensure extensions and views exist

Acceptance:
- Typing 7-digit IMO, 9-digit MMSI, or a name returns expected records
- Entity page shows summary arrays and full provenance rows

---

## Stage 9 — Make Targets (one-liners)

Targets (see Makefile):
- `make parquet` — Build Parquet at `data/mvp/vessels_mvp.parquet`
- `make md.load` — Load Parquet into MotherDuck (requires `MOTHERDUCK_TOKEN`)
- `make pg.dev.up` — Start local Postgres 17.6
- `make pg.dev.load` — Load Parquet into local Postgres via DuckDB (CTAS)
- `make pg.dev.index` — Add PK + indexes to local Postgres
- `make graphql.up` — Start PostGraphile on http://localhost:5000
- `make supabase.load` — Load Parquet into Supabase (requires `SUPABASE_PG`)

## Stage 8 — Tests & Code Quality (burn list)

Goal: Confidence for tomorrow’s demo without over-building.

Unit tests (pytest):
- Dataset builder (scripts/mvp_build_dataset.py)
  - Preserves original values (no destructive rewrite)
  - Adds provenance columns: RFMO, SOURCE_FILE, SOURCE_ROW
  - Adds identity columns: JOIN_KEY, COMPOSITE_KEY, ENTITY_ID (non-destructive)
  - Optional: `--dedupe` collapses only when requested
- Loader (Supabase):
  - Dry-run create/append using a small fixture DataFrame
  - Verifies lowercase columns and index creation statements are executed

Style/quality:
- Use existing pre-commit (already configured in repo)
- Keep changes minimal; avoid introducing new tooling tonight

Commands:
- `pytest -q`
- `pre-commit run -a`

Acceptance:
- All tests pass locally
- Pre-commit runs clean

---

## Stage 7 — Post-Demo Cleanup (after #261 lands)

Goal: Remove temporary accent-insensitive comparison from reconciliation config. This does not affect the MVP dataset builder.

Tasks:
- Remove `unicode.accent_insensitive_columns: [VESSEL_NAME]` from `tests/reconciliation/diff_config.yaml`
- Re-run reconciliation validation (non-blocking for MVP)

---

## Notes & Decisions

- **No destructive merging**: Every source row is retained with `RFMO`, `SOURCE_FILE`, and `SOURCE_ROW`.
- **Identity keys**: `JOIN_KEY` (IMO if present), `COMPOSITE_KEY` (first complete set), `ENTITY_ID` (label to group, not a merge).
- **Parquet as source-of-truth** for analytics; Postgres used for UI lookups/GraphQL.
- **Repo**: Use this repo to avoid churn before the meeting; consider a split after demo.
