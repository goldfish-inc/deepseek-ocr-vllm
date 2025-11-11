# Argilla Auto-Discovery (Autoload) — Spec

Goal
- New merged Parquet drops (argilla_records.parquet) should automatically appear in Argilla without manual commands.

Approach
1) Naming convention: place merged Parquet at
   `s3://<bucket>/argilla/in/vessels_ocr_<batch_id>/argilla_records.parquet`
2) Autoload job (CronJob or systemd timer) scans for new datasets and calls Argilla to ingest.
3) State is tracked in MotherDuck `md_annotated.main.argilla_ingest_log` to ensure idempotency.

Dataset Config (mapping)
```yaml
# configs/argilla/dataset.example.yaml
name: vessels_ocr_<batch_id>
task: TokenClassification
source:
  type: parquet
  path: s3://<bucket>/argilla/in/vessels_ocr_<batch_id>/argilla_records.parquet
  id_column: id
  text_column: text
  metadata_columns: [doc_id, page_num, text_sha256]
  suggestions_column: suggestions_json
```

Autoload Workflow
1) Discover new datasets:
   - List prefixes under `s3://…/argilla/in/` matching `vessels_ocr_*` that contain `argilla_records.parquet`.
   - For each dataset, check `md_annotated.main.argilla_ingest_log` for `(dataset, object_uri)`; skip if present with status ingested.
2) Ingest:
   - Use Argilla API to add records from Parquet (see `scripts/load_argilla_records.py` for wire format) or a native CLI/SDK method if available.
   - Update `argilla_ingest_log` status to `ingesting` → `ingested` (or `failed` with `message`).
3) Idempotency:
   - Primary key `(dataset, object_uri)` prevents duplicate ingestion.
   - Include ETag/size when available to detect content changes.

Kubernetes CronJob (example)
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: argilla-autoload
spec:
  schedule: "*/15 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: autoload
              image: ghcr.io/oceanid/argilla-autoload:latest
              env:
                - name: ARGILLA_API_URL
                  valueFrom: { secretKeyRef: { name: argilla, key: api_url } }
                - name: ARGILLA_API_KEY
                  valueFrom: { secretKeyRef: { name: argilla, key: api_key } }
                - name: MD_TOKEN
                  valueFrom: { secretKeyRef: { name: motherduck, key: token } }
                - name: INPUT_PREFIX
                  value: s3://<bucket>/argilla/in/
```

State Table (DDL)
- See `sql/motherduck/argilla_ingest_log.sql` and run it in `md_annotated`.

Notes
- Argilla does not poll S3 by itself; the autoload job acts as the watcher and triggers ingestion, satisfying the “auto discovery” requirement.
- Keep the autoload image minimal; reuse the logic from `scripts/load_argilla_records.py` and add a lightweight S3 prefix scanner.
- For S3 scanning, you can use DuckDB’s httpfs + `read_parquet` with globs, or boto3 for robust listing and ETag/LastModified.
