# EBISU Data Dictionary & Lineage

This document describes the authoritative EBISU vessel schema, provenance tables, and staging lineage. It is the contract for data producers and consumers (ETL, GraphQL, analytics).

Version: v1 (core + history pattern)

## Lineage
- Raw sources: RFMO/national CSVs (stored with file name + row number).
- Cleaners: one per source → unified CSV + canonical Parquet (provenance preserved).
- Stage: Parquet → stage.vessels_load (batch_id, loaded_at).
- Normalize: stage → ebisu.* (current row + reported history + per-source provenance).
- Serving: Views/functions in public.* (search, report), PostGraphile exposes ['public','ebisu'].

## Schemas
- stage — landing tables for batch loads (schema-on-read, ephemeral).
- ebisu — normalized vessel domain (current row + history + provenance + sources).
- public — UI views and helper functions for GraphQL.

---

## stage.load_batches
- batch_id (uuid, PK) — Unique load id.
- loaded_at (timestamptz) — Timestamp of batch creation.
- source (text) — Optional source tag.
- artifact_checksum (text) — Optional Parquet checksum.
- notes (text) — Free-form notes.

Notes
- Created by sql/ebisu_stage.sql.
- Referenced in normalization audit.

## stage.vessels_load
- Columns: created by CTAS from Parquet (schema-on-read); loader appends:
  - batch_id (uuid, default gen_random_uuid())
  - loaded_at (timestamptz, default now())
- Expected unified columns include: entity_id, vessel_name, imo, mmsi, ircs, rfmo, source_file, source_row, flag, ...

Notes
- Recreated per batch; used only as normalization input and provenance source.

---

## ebisu.vessels (current)
- vessel_uuid (uuid, PK)
- vessel_name (text)
- vessel_flag (uuid, FK → reference.country_iso.id)
- vessel_name_other (text)
- imo (char(7), unique where not null)
- ircs (varchar(15))
- mmsi (char(9))
- national_registry (varchar(50))
- national_registry_other (varchar(50))
- eu_cfr (char(12))
- created_at (timestamptz)
- updated_at (timestamptz)

Indexes
- vessels_imo_idx (unique where imo is not null)
- vessels_eu_cfr_idx (unique where eu_cfr is not null)
- vessels_mmsi_idx (btree)
- vessels_flag_idx (btree)
- vessels_name_idx (btree)
- ebisu_vessels_vname_trgm_idx (gin, vessel_name gin_trgm_ops) [search]

Notes
- Holds current values. Historical changes are recorded in ebisu.vessel_reported_history.

## ebisu.vessel_reported_history (changes)
- history_uuid (uuid, PK)
- vessel_uuid (uuid, FK → ebisu.vessels.vessel_uuid)
- source_id (uuid, FK → ebisu.original_sources_vessels.source_id)
- reported_history_type (enum reported_history_enum)
  - VESSEL_NAME_CHANGE, FLAG_CHANGE, IMO_CHANGE, IRCS_CHANGE, MMSI_CHANGE, REGISTRY_CHANGE, VESSEL_TYPE_CHANGE, OWNERSHIP_CHANGE, OTHER_CHANGE
- identifier_value (text) — New value (or the one reported).
- flag_country_id (uuid, FK → reference.country_iso.id) — For flag changes.
- created_at (timestamptz)

Indexes
- vessel_history_vessel_idx (vessel_uuid)
- vessel_history_type_idx (reported_history_type)
- vessel_history_value_idx (identifier_value)
- vessel_history_flag_idx (flag_country_id)
- vessel_history_source_idx (source_id)

Notes
- Insert one row per field change. ETL derives comparisons vs. current row.

## ebisu.original_sources_vessels (source registry)
- source_id (uuid, PK)
- source_shortname (text, unique)
- source_fullname (text)
- version_year (date, year-only)
- source_types (enum[] vessel_source_type_enum)
- refresh_date (date)
- source_urls (jsonb)
- update_frequency (enum)
- size_approx (int)
- status (enum)
- created_at (timestamptz)
- last_updated (timestamptz)
- rfmo_id (uuid, FK → reference.rfmos.id) [optional]
- country_id (uuid, FK → reference.country_iso.id) [optional]
- metadata (jsonb)

Indexes
- GIN: source_types, source_urls, metadata
- Btree: shortname, status, refresh_date, version_year, update_frequency, rfmo_id, country_id

Notes
- ETL uses ebisu.ensure_source() to auto-create minimal RFMO source entries as needed.

## ebisu.vessel_sources (vessel ←→ source)
- vessel_uuid (uuid, FK → ebisu.vessels)
- source_id (uuid, FK → ebisu.original_sources_vessels)
- is_active (bool)
- first_seen_date (date)
- last_seen_date (date)

Indexes
- vessel_sources_vessel_idx, vessel_sources_source_idx, vessel_sources_active_idx, vessel_sources_last_seen_idx

Notes
- Upsert based on (vessel_uuid, source_id); update last_seen_date per batch.

## ebisu.vessel_source_identifiers (per-source identifiers)
- source_identifier_uuid (uuid, PK)
- vessel_uuid (uuid, FK → ebisu.vessels)
- source_id (uuid, FK → ebisu.original_sources_vessels)
- identifier_type (enum identifier_type_enum)
- identifier_value (text)
- associated_flag (uuid, FK → reference.country_iso.id) [optional]
- created_at (timestamptz)

Indexes
- vessel_source_identifiers_vessel_idx, _type_idx, _value_idx, _source_idx, _flag_idx

Notes
- Contains all reported identifiers per source. Duplicates from the same batch are ignored.

---

## ebisu.load_collisions (ETL conflict log)
- id (bigserial, PK)
- batch_id (uuid) — ETL batch where conflict observed
- id_type (text) — 'imo' | 'mmsi'
- id_value (text)
- vessel_uuid (uuid) — entity updated/matched in this batch
- other_vessel_uuid (uuid) — existing entity already holding the id
- detected_at (timestamptz)

Indexes
- load_collisions_id_idx (btree on id_type,id_value)

Notes
- Appended by transform for each IMO/MMSI conflict per batch.
- Used to drive the reviewer queue below.

## ebisu.collision_reviews (review status per identifier)
- review_id (bigserial, PK)
- id_type (text) — 'imo' | 'mmsi'
- id_value (text)
- status (review_status_enum) — NEW, ACKNOWLEDGED, RESOLVED, DISMISSED
- resolution (review_resolution_enum) — CHOOSE_EXISTING, REASSIGN_ID, MERGE_ENTITIES, DATA_ERROR
- reviewer (text)
- resolution_notes (text)
- created_at (timestamptz)
- updated_at (timestamptz)

Constraints
- UNIQUE (id_type, id_value) — one review row per conflicting identifier.

Notes
- Tracks current review status and outcome for a given conflicting identifier.
- Trigger maintains `updated_at`.

---

## public.ui_vessels (view)
- entity_id (text) — vessel_uuid::text
- vessel_name, imo, mmsi, rfmo (when derivable)

## public.ui_vessel_report (view)
- Current fields from ebisu.vessels + historical arrays (names, imos, mmsis)
- rfmo list from provenance tables
- Conflict flags derived from history/identifiers

## Functions
- public.search_vessels(q text, limit_n int) returns SETOF public.ui_vessels
  - Accent-insensitive ILIKE + trigram order; uses gin index
- public.vessel_report(p_entity_id text) returns public.ui_vessel_report

## public.ui_collision_review_queue (view)
- queue_id (text) — synthetic primary key `id_type || ':' || id_value`
- id_type, id_value — identifier group for the conflict
- collisions_count (int) — number of collision rows logged
- first_detected, last_detected (timestamptz)
- vessel_uuids (uuid[]) — all entities involved across collisions for this identifier
- status (review_status_enum), resolution (review_resolution_enum), reviewer, resolution_notes, last_reviewed_at

Notes
- Groups `ebisu.load_collisions` by `(id_type,id_value)` and left-joins `ebisu.collision_reviews`.
- PostGraphile smart comment sets `@primaryKey queue_id`.

## public.resolve_collision(p_id_type, p_id_value, p_resolution, p_reviewer, p_notes)
- Upserts `ebisu.collision_reviews` for the identifier with status=RESOLVED and returns the updated row from `public.ui_collision_review_queue`.

## Additional Review Lifecycle Functions
- public.ack_collision(p_id_type, p_id_value, p_reviewer, p_notes)
  - Marks a collision as ACKNOWLEDGED (still unresolved) and returns queue row.
- public.dismiss_collision(p_id_type, p_id_value, p_reviewer, p_notes, p_resolution='DATA_ERROR')
  - Marks a collision as DISMISSED with a resolution, returns queue row.
- public.reopen_collision(p_id_type, p_id_value, p_reviewer, p_notes)
  - Reverts status to NEW (clears resolution), returns queue row.

## Convenience Selectors
- public.top_unresolved_collisions(limit_n int = 5) → SETOF public.ui_collision_review_queue
  - Unresolved only, ordered by collisions_count desc, last_detected desc.
- public.collisions_for_vessel(p_vessel_uuid uuid) → SETOF public.ui_collision_review_queue
  - All collision groups involving a vessel, newest first.
- public.collisions_since(p_since timestamptz, unresolved_only bool = true) → SETOF public.ui_collision_review_queue
  - Collision groups since timestamp, optionally unresolved only.

---

## Quality Gates (pre‑promote)
- Table presence: ebisu.vessels, ebisu.vessel_reported_history, stage.load_batches
- Name empties: <= 60% on current rows (tighten over time)
- IMO uniqueness: enforced + double‑checked
- Format warnings: IMO (7 digits), MMSI (9 digits)
- FK integrity: provenance tables reference existing vessels/sources

Run
- `make cb.test.schema`

---

## Retention & Reproducibility
- Parquet is canonical and versioned (checksum).
- Stage is ephemeral (recreated per batch; batch_id persisted in load_batches).
- History (vessel_reported_history) is append‑only.
- Provenance tables grow with sources; consider partitioning by year if needed.

---

## Notes for Contributors
- Schema changes: extend Drizzle schemas in `sql/oceanid-ebisu-schema/drizzle-schemas` and generate migrations.
- ETL/Transforms: keep in SQL (`sql/ebisu_transform.sql`) for transparency and testing.
- Update this dictionary when schema changes. PRs touching schema will be asked to include a doc update.
