# Focus: Database Stabilization and Tenant Enrichment

Phase: 0–2 active. Tenant enrichment and Label Studio are out of scope here.

## Active Scope (Oceanid)

- Stage → Curated pipeline (contracts, migrations, tests)
- Temporal + provenance model per ADR-001
- Optional curated views (e.g., enrichment view) as stable read contracts

## Out of Scope / Paused

- Label Studio UI and `label.*` schema/migrations (blocked by CI guard)
- ML/Active Learning integration work beyond what’s needed to keep the pipeline healthy
- Tenant enrichment orchestration (workers, per-tenant upserts) — tracked in @ocean

## Links

- Roadmap: `docs/DB_ROADMAP.md`
- Schema Status: `sql/SCHEMA_STATUS.md`
- ADR-001: `docs/ADR/ADR-001-temporal-provenance-model.md`
