# ADR-001: Temporal + Provenance Model for Public Datasets

Status: Accepted

## Decision

Adopt a domain-agnostic temporal and provenance model to capture facts as assertions with validity windows and complete lineage to dataset versions and ingestions. Keep a minimal set of typed hot fields; retain an assertions table (temporal EAV) for long-tail attributes. Provide denormalized “latest” views and tenant-facing enrichment views.

## Context

We ingest diverse public datasets (e.g., maritime registries from different jurisdictions) and unstructured sources (PDFs). Facts change over time (e.g., watchlist membership). We need:

- As-of queries (what was true in 2024 vs 2025)
- Provenance (source dataset version, ingestion run, and document/row)
- Stable tenant contracts that can evolve without breaking consumers

## Implementation Outline

- Core registry: `control.sources`, `control.dataset_versions`, `control.ingestions`
- Raw capture: `raw.records` (jsonb payload + checksum) with links to dataset version and document
- Stage: normalized, worker-friendly tables with `ingestion_id` and `document_id`
- Curated:
  - Canonical entities (e.g., `curated.vessels`)
  - Identifiers with validity windows (`curated.vessel_identifiers`)
  - Attribute assertions (temporal EAV) with `valid_from/to`, `recorded_at`, `confidence`, provenance IDs
  - Events (e.g., `vessel_watchlist_memberships`) with effective periods
  - Latest views + `vessels_enrichment_view` as the tenant contract

## Rationale

- Scale across commodities by repeating the same pattern per domain (`curated.maritime.*`, later other domains)
- Keep DB invariants and audit in Postgres; let GraphQL compose evolving business logic
- Promote stable derived logic into SQL materialized views over time

## Consequences

- Additional tables for assertions and registries
- Clear separation of current vs historical queries via views and predicates on `valid_from/valid_to`
