Argilla → Parquet Exporter
==========================

Goal
----
Export SME‑annotated data from Argilla to Parquet with a stable schema and push to R2 for MD ingestion.

Flow
----
1) Read reviewed records from Argilla (dataset/version)
2) Normalize to schema.json (types, enums)
3) Write partitioned Parquet to R2 (s3://ocean/<dataset>/y=YYYY/m=MM/d=DD)
4) Update dataset_registry; trigger MD ingestion

Notes
-----
- Keep text fields normalized (trim, NFC)
- Explicit null handling; no mixed types per column
- Attach provenance fields: source_id, labeler_id, review_timestamp, version

CLI Sketch
----------
argilla-export \
  --dataset vessels_ner \
  --since 2025-01-01 \
  --schema schema.json \
  --out s3://ocean/vessels_ner/y=2025/m=11/d=10/
