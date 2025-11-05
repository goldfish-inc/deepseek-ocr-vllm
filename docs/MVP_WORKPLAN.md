# MVP Data Stack Workplan (Staged)

Scope: Deliver a single, queryable vessel dataset for a live demo (tomorrow), with fast analytics and GraphQL-ready lookups. Preserve every source row and provenance; no destructive merging.

Repo: Use this repo for speed (scripts + docs are already here). We can split later if needed.

---

## Stage 1 — Build Dataset (Parquet as source-of-truth)

Goal: Produce one Parquet file with all rows + provenance and non-destructive identity keys.

Commands:
- `python scripts/mvp_build_dataset.py --parquet data/mvp/vessels_mvp.parquet`

Output Columns (key subset):
- `RFMO`, `SOURCE_FILE`, `SOURCE_ROW` (provenance)
- `JOIN_KEY` (e.g., IMO), `COMPOSITE_KEY`, `ENTITY_ID` (label to group; non-destructive)
- All original source columns (e.g., `IMO`, `MMSI`, `VESSEL_NAME`, ...)

Acceptance:
- Parquet exists at `data/mvp/vessels_mvp.parquet`
- Row count equals sum of all baseline rows; values unchanged

---

## Stage 2 — Local Postgres 17.6 for Lookups/GraphQL

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
