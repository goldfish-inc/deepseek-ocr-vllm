# Schema Status and Decisions

This file inventories current SQL, highlights mismatches, and records decisions while we converge on a stable schema.

## Inventory

- `sql/migrations/`
  - `V1__staging_baseline.sql`, `V2__views_freshness_duplicates.sql`, `V3__staging_tables_complete.sql`, `V4__curated_reference_tables.sql`, `V5__curated_temporal_events.sql`, `V6__vessel_info_typed_columns.sql`
  - `V7__stage_contract_alignment.sql` (worker-safe staging schema)
  - `V8__curated_core_entities.sql` (canonical maritime entities)
  - `V10__dataset_registry.sql` (provenance registry)
  - `V11__temporal_assertions.sql` (long-tail assertions & events)
  - `V12__stage_to_curated_promotions.sql` (deterministic promotions + enrichment view)
  - `20251018_intelligence_db.sql` (WIP domain model draft)
- `sql/emergency_schema_patch.sql`
  - Removed; history now covered by `V7__stage_contract_alignment.sql`.
- `scripts/legacy-pandas-cleaners/`
  - Pre-DB cleaning logic intended for import; now replaced by Go workers, but mappings inform `stage.*` and `curated.*` designs.

## Known Mismatches

- Consolidated bootstrap scripts have been removed; use versioned migrations only.
- Legacy `label.*` tables are retired. Any future human-in-the-loop storage will flow through Argilla/MotherDuck schemas instead.

## Decisions

- Versioned migrations are the authoritative path forward; consolidated initializer removed from repo (Nov 2025).
- Staging schema adds worker-safe scalar columns via `V7__stage_contract_alignment.sql`; ad-hoc patch slated for removal once mirrors confirmed.
- Maintain canonical vessel tables with typed hot fields (`curated.vessel_info_typed`) and long-tail assertions (`V11`) for temporal history.
- Provide a denormalized `curated.vessels_enrichment_view` as the tenant-facing contract (delivered as part of `V12__stage_to_curated_promotions.sql`).

## Next Actions

- [x] Author `V7__stage_contract_alignment.sql` to fold in emergency patch changes (scalar columns/indexes).
- [x] Author `V8__curated_core_entities.sql` to create/adjust `vessels`, `vessel_identifiers`, `vessel_info_typed`, `vessel_associates` with keys/indexes.
- [x] Author `V10__dataset_registry.sql` to establish dataset versions + ingestions and link stage/curated tables.
- [x] Author `V11__temporal_assertions.sql` to introduce long-tail assertions and watchlist events.
- [x] Author `V12__stage_to_curated_promotions.sql` with deterministic promotion function, audit log, and enrichment view.
- [x] Author `V9__enrichment_view.sql` exposing `curated.vessels_enrichment_view` (**fulfilled via V12; no additional migration required**).
- [x] Remove legacy `label.*` initializer content; future annotation schemas will live alongside Argilla exporters.
