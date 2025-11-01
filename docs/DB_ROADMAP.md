# Oceanid Database Roadmap

Status (2025-11-01): Phases 0–2 complete on `main`. Label Studio UX remains paused; focus shifts to validating migrations in deployed environments and integrating enrichment with @ocean.

This roadmap turns the current staging-focused pipeline into a stable, versioned global database that downstream tenants (@ocean on Neon) can consume for enrichment.

## Phase 0 — Stabilize What Exists (Stopgap) ✅

- Freeze Label Studio work and any label.* schema changes (keep integration disabled).
- Lock down a stable contract for `stage.*` used by Go workers:
  - Consolidate the temporary fixes from `sql/emergency_schema_patch.sql` into proper migrations.
  - Ensure `stage.cleaning_rules`, `stage.csv_extractions`, and `stage.document_processing_log` have the scalar columns workers expect.
- Cut a minimal “staging to curated” path for a handful of fields (IMO/MMSI/Name/Flag/Vessel Type) to exercise end‑to‑end flow.

Acceptance

- Go workers (csv/pdf) run without schema errors against the database.
- A single representative source flows to curated tables with audit trail intact.

## Phase 1 — Global Schema (Curated) First ✅

Design and implement the production data model for maritime intelligence.

- Entities (curated.*):
  - `vessels` (identity row per vessel; unique keys: imo, mmsi, ircs handled via a identifiers table or unique nullable columns)
  - `vessel_identifiers` (alt IDs with validity windows)
  - `vessel_info` (typed columns for common fields such as `vessel_type`, `build_year`, `flag`; retain EAV for long tail attributes)
  - `vessel_associates` (owner/operator/charterer/master/etc.)
  - `ports`, `country_iso` (refs)
  - `vessel_events` (temporal changes, data provenance)
  - `vessel_sanctions` (if applicable)
  - Harmonization tables: `gear_types_fao`, `harmonized_species` (already referenced in `labels.json`)
- Contracts:
  - Primary keys, uniqueness, and foreign keys defined.
  - Audit fields (`created_at`, `updated_at`, `source_type`, `source_name`, provenance)
  - Indexes for common queries (lookups by IMO/MMSI, vessel name, recent events)
- Remove or postpone Label Studio specific tables (`label.*`) until after schema is stable.

Acceptance

- Versioned migrations create curated schema with keys and indexes.
- Materialized or standard views expose the minimal enrichment surface for tenants:
  - `curated.vessels_enrichment_view` with essential denormalized fields.

## Phase 2 — Pipeline Alignment (Workers → Stage → Curated) ✅

- Align Go workers to the finalized `stage.*` contract and add tests.
- Write deterministic promotions from `stage.*` to `curated.*` (idempotent upserts; conflict handling; data provenance captured).
- Seed default cleaning rules and validation views.

Acceptance

- Deterministic re-runs produce same curated results for the same inputs.
- Backfills succeed for legacy CSVs without manual intervention.

## Deliverables & Tracking

- ✅ Convert consolidated SQL into versioned migrations (no ad‑hoc patches).
- ✅ Add `SCHEMA_STATUS.md` tracked under `sql/` to capture decisions, drift, and open items.
- ✅ Create GitHub issues (milestones per phase) in `goldfish-inc/oceanid` for Phases 0–2 (schema/pipeline).
- ⏳ Track post-merge validation tasks:
  - goldfish-inc/oceanid#242 — Deploy V7–V12 migrations to staging/prod and run promotion smoke tests.
  - goldfish-inc/oceanid#243 — Document promotion workflow (DB_ROADMAP, operations guide) and keep SCHEMA_STATUS.md current.

## Out of Scope (tracked elsewhere)

- Tenant enrichment orchestration (workers, per-tenant upserts) is tracked in the `goldfish-inc/ocean` platform repo. Oceanid provides the curated data and views; Ocean performs tenant writes.
- Label Studio/SME and Active Learning are paused. Reintroduction will be planned later and should not block Phases 0–2.

## Open Questions / Next Focus

- Exact split between typed vs EAV for `vessel_info`—continue to monitor high-usage attributes; promote to typed columns as needed.
- Replication vs service push for tenant enrichment—initial plan is service push driven by @ocean integration (issue goldfish-inc/ocean#4).
- Scheduling and automation for `curated.promote_ingestion()` (hourly/ nightly batch) once tenant integration is live.
