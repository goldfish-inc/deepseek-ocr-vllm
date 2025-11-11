# E2E Pilot Runbook (Pre‑Annotation + Argilla)

This runbook validates the full pipeline on a small pilot batch before enabling larger ingestion.

Scope
- Upload → OCR (HF DeepSeek) → Parquet in R2 → MotherDuck (md_raw_ocr)
- Pre‑annotation (DGX Spark + Ollama) → suggestions Parquet
- Merge pages + suggestions → argilla_records.parquet
- Argilla ingestion (autoload or sync worker)
- SME review → Argilla export → md_annotated

Prereqs
- Secrets: MOTHERDUCK_TOKEN, R2 creds, ARGILLA API/Access configured
- MD DBs created: `md_raw_ocr`, `md_annotated`
- DGX endpoint reachable (ollama-api.boathou.se)
- Argilla cluster healthy (pods green)

1) Select Pilot Batch (3–10 PDFs)
- Upload via HF Space and note `doc_id` receipts
- Create a local list of `doc_id` values

2) OCR → Parquet → MotherDuck
- Confirm Parquet landed in R2 under `md_raw_ocr/{documents,pages}/...`
- Load to MD:
  - `duckdb -unsigned`
  - `SET motherduck_token='…';`
  - `ATTACH 'md:md_raw_ocr' AS rawdb (READ_WRITE);`
  - `.read sql/motherduck/examples_load_parquet.sql`
- Sanity checks:
  - `SELECT COUNT(*) FROM rawdb.main.raw_documents WHERE doc_id IN ('…');`
  - `SELECT COUNT(*) FROM rawdb.main.raw_pages WHERE doc_id IN ('…');`
  - `SELECT * FROM rawdb.main.vw_argilla_pages WHERE doc_id IN ('…') LIMIT 5;`

3) Pre‑Annotation (DGX Spark + Ollama)
- Run the Spark job to produce suggestions Parquet for those `doc_id`s (see `docs/operations/preannotation-spark-ollama-spec.md`).
- Verify Parquet exists under `s3://…/argilla/in/vessels_ocr_<batch_id>/suggestions/`.

4) Merge for Argilla
- Produce merged records:
  - `.read sql/motherduck/merge_suggestions_for_argilla.sql`
  - Set `_params.pages_glob`, `_params.suggestions_glob`, `_params.output_uri` for your batch.
- Confirm the output `argilla_records.parquet` at the target URI.

5) Argilla Ingestion (choose one)
- A) Autoload (preferred): set up the CronJob per `docs/operations/argilla-auto-discovery.md` and confirm the dataset `vessels_ocr_<batch_id>` appears within 15 minutes.
  - MD state: `ATTACH 'md:md_annotated' AS anndb (READ_WRITE);`
  - `SELECT * FROM anndb.main.argilla_ingest_log WHERE dataset='vessels_ocr_<batch_id>';`
- B) Sync worker (existing): ensure argilla-sync worker runs and creates records in Argilla.

6) SME Review → Export → md_annotated
- SMEs annotate a handful of records.
- Export annotated Parquet from Argilla to your `out` prefix.
- Load to MD:
  - `ATTACH 'md:md_annotated' AS anndb (READ_WRITE);`
  - `.read sql/motherduck/load_annotated_parquet.sql`
  - Set `_params.argilla_dataset`, `pages_glob`, `spans_glob`.

7) Integrity & Coverage Gates
- Run: `.read sql/motherduck/checks_integrity.sql`
- Gates (pilot pass criteria):
  - Coverage: 0 documents without pages (CHECK 1)
  - Text hashes: 0 mismatches or investigated (CHECK 3)
  - Orphans: 0 annotated pages without raw (CHECK 8)
  - Export audit: `record_count` matches pages exported (CHECK 6)

8) Sign‑off
- Record doc_id list, counts, and integrity results in the pilot log.
- Enable batch ingestion.

Tips
- If autoload is enabled, set the schedule to 5–15 minutes during pilot.
- Keep batch small to iterate quickly.
- For Argilla API verification, a simple probe can list dataset records by ID; otherwise verify via UI.
