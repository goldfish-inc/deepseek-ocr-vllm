MotherDuck OCR/Annotation Databases
===================================

This folder contains DDL to create two append-only MotherDuck databases with strict raw/annotated separation and provenance:

- md_raw_ocr: DeepSeek OCR outputs only (no transforms)
- md_annotated: Argilla annotations and review metadata (no OCR text mutation)

How To Use
----------

Option A — DuckDB CLI with MotherDuck

1) Install DuckDB and sign in to MotherDuck:
   - duckdb extension install motherduck
   - duckdb -unsigned
   - SET motherduck_token='YOUR_MD_TOKEN';

2) Attach the databases and run DDLs:

   -- Raw OCR DB
   ATTACH 'md:md_raw_ocr' AS rawdb (READ_WRITE);
   SET schema 'rawdb.main';
   .read raw_ocr.sql
   .read views_raw.sql

   -- Annotated DB
   ATTACH 'md:md_annotated' AS anndb (READ_WRITE);
   SET schema 'anndb.main';
   .read annotated.sql
   .read views_annotated.sql

Option B — MotherDuck Web/Notebook

- Create two databases `md_raw_ocr` and `md_annotated`
- Execute the corresponding DDLs in each database

Operational Notes
-----------------
- Append-only: Do not run UPDATE/DELETE in either DB. New runs append rows.
- Provenance: Always populate hashes (doc_sha256, text_sha256) and version fields (hf_space_commit, export_run_id).
- Views: `vw_argilla_pages` reads the latest OCR run per document; `vw_latest_annotations_spans` resolves to the most recent Argilla export per dataset.
- Permissions: Use separate tokens/service accounts for loaders (`raw_loader`, `argilla_loader`); enforce least privilege.

Loading Data
------------
See `examples_load_parquet.sql` for DuckDB COPY FROM snippets to load DeepSeek Parquet outputs into raw_documents and raw_pages.

Integrity Checks
----------------
Run `checks_integrity.sql` daily or post-load to validate:
- Coverage (all docs have pages; page counts match)
- Hash integrity (text_sha256 matches recomputed hash)
- Append-only guarantees (no duplicates; no mutations)
- Argilla sync completeness (all pages pushed; all annotations pulled)

See inline comments for thresholds and performance notes.
