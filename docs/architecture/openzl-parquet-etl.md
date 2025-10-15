# OpenZL + Parquet ETL for Label Studio (k3s)

## Context & Goals

- Convert Label Studio Community Edition exports (JSON/CSV) into columnar Parquet to enable fast, schema-enforced analytics and storage efficiency.
- Apply OpenZL as an additional compression layer for 2–4x total size reduction vs raw JSON (Parquet + OpenZL).
- Publish artifacts to Hugging Face (HF) for active learning and archive, and insert “clean data” into Crunchy Bridge Postgres.
- Fit Oceanid’s Go-first stack, k3s deployment, and existing components without requiring Label Studio Enterprise.

## Fit With Current Repo

- Services: Go microservices on scratch are the norm (`apps/annotations-sink`, `apps/ls-triton-adapter`, `apps/project-bootstrapper`). The ETL should be a separate Go Job/CronJob (not the always-on sink).
- Training: `apps/training-worker` (Python) pulls JSONL shards from HF (`vertical=*/schema-*/project-*/**/*.jsonl`) and normalizes to model-specific training rows. Keep JSONL for training compatibility; add Parquet(+OpenZL) in parallel for archive/analytics.
- Database target: `cluster/sql/cleandata` defines the “clean data” schema. ETL will map LS exports to these tables (or a derived staging schema → `cleandata`).
- Infra patterns: Pulumi component resources in `cluster/src/components` provision Deployments/Jobs; images come from GHCR; `imagePullSecrets: ghcr-creds`; secrets via ESC. The ETL follows the same conventions.

## High-Level Architecture

1. Label Studio (Community Edition) exports JSON/CSV to S3.
2. ETL CronJob on k3s:
   - Detects new exports in S3 (idempotent scan).
   - Parses JSON/CSV → typed records (schema validation).
   - Writes Parquet (zstd) to a temp path.
   - Optionally compresses Parquet with OpenZL to `.parquet.zl`.
   - Publishes artifacts to HF dataset repo under date/project prefixes.
   - Loads “clean data” into Crunchy Bridge Postgres.
3. Consumers:
   - Training worker continues to read JSONL; Parquet(.zl) serves archive/analytics and future parquet-native training.

## Prerequisites

- Go 1.25.x for the ETL job (existing services may stay on 1.23).
- Go libs:
  - `github.com/xitongsys/parquet-go` (Parquet writer/reader)
  - `github.com/jackc/pgx/v5` (Postgres driver + `CopyFrom`)
  - `github.com/aws/aws-sdk-go-v2` (S3)
  - Optional: minimal HTTP client for HF Hub API (stdlib `net/http`).
- OpenZL CLI binaries: build from `github.com/facebook/openzl` (dev head). Requires CMake/Make toolchain. Use OPT build; package as sidecar or bundled in the ETL image base (non-scratch).
- Crunchy Bridge Postgres 17.5. If `pg_parquet` is available and supports S3 URIs, the ETL can trigger server-side reads; otherwise, prefer client-side inserts.

## Design Decisions

### Postgres Load Strategy

- Default: Client-side insert using `pgx.CopyFrom`.
  - Pros: Works on managed DBs; no server file access; robust.
  - Cons: Parquet is an intermediate artifact (we still parse and stream rows to DB).
- Optional (if available): Server-side load via `pg_parquet` from S3 URIs.
  - Preconditions: Extension enabled on Crunchy Bridge; S3 access configured for the DB; table schema compatible.
  - Note: Avoid `COPY FROM '/path'` since DB server cannot see pod file paths.

### OpenZL Packaging

- Keep ETL Go container small and deterministic. Package OpenZL binaries in one of:
  - Sidecar container that mounts a shared `emptyDir` volume with the ETL.
  - Non-scratch base (e.g., `alpine`/distroless/cc) for the ETL image where OpenZL binaries are copied to `/usr/local/bin`.
- Failure policy: Proceed with plain Parquet (zstd) if OpenZL compression fails; emit metrics/logs and mark the run “degraded”.

### Publishing & Storage

- Prefer HF Hub HTTP API (create_repo, create_commit) for JSONL annotations (mirrors `apps/training-worker` approach).
- Original PDFs remain in S3 (Label Studio per‑project storage) and are not copied to HF or DB. The ETL reads PDFs directly from S3 when needed.
- Layout proposal:
  - JSONL (training): `vertical=<vertical>/schema-<version>/project-<project_id>/<YYYY>/<MM>/<DD>/<HH>/batch-<uuid>.jsonl`
  - Parquet: `parquet/{date}/project-{project_id}/{export_id}.parquet`
  - OpenZL: `parquet/{date}/project-{project_id}/{export_id}.parquet.zl`

### Orchestration: Poll vs Events

- Start with a CronJob that scans the S3 export prefix for new objects (idempotency via object ETag/LastModified tracking in a small state table).
- S3→SQS/SNS→k3s eventing can be added later.

### Alternate Path (Python/PyArrow)

- If desired, a compact Python job with PyArrow can perform JSON/CSV→Parquet conversion, with the Go ETL handling S3/HF/DB orchestration.
- This repo already ships a Python image (`apps/training-worker`), making it operationally acceptable to host PyArrow where needed. Default remains Go-only for control and footprint.

## Schema & Mapping

- Upstream: Label Studio task/annotation exports. The ETL normalizes fields like `project_id`, `task_id`, `data.text` (or table rows), `result[*].value` (labels, spans, etc.), plus metadata (`completed_by`, timestamps).
- Target: `cleandata` schema (see `cluster/sql/cleandata/001_create_schema.sql`). Example mapping strategies:
  - Text entity spans → normalized columns (e.g., `vessels` key fields) + the full record in JSONB `cleaned_data`.
  - Table extractions → JSONB `raw_data`/`cleaned_data` with selected normalized columns populated if reliable.
- Maintain lineage: store LS `project_id`, `task_id`, export timestamp, S3 object key, and hash/ETag as columns for traceability.

## Implementation Plan

1. Prototype Locally
   - Scaffold `apps/ls-parquet-etl` (Go 1.25). Add `go.mod` with `pgx/v5`, `aws-sdk-go-v2`, `parquet-go`.
   - Build OpenZL (`make`) and verify `zl-compress`/`zl-decompress` locally.
   - Define record structs and mapping from LS JSON/CSV to typed rows; round-trip small sample.
   - Write Parquet (zstd) and compress with OpenZL; benchmark size and speed.
   - Insert rows into a local Postgres (client-side `CopyFrom`).

2. S3 Integration
   - List objects by prefix; filter new ones using a state store (DB table `etl_runs` or local cache).
   - Download to `/tmp`; process; upload artifacts back to HF; update state atomically.

3. Hugging Face Push
   - Use HF Hub API from Go to create/update dataset repo and commit files.
   - Preserve JSONL training files; add Parquet(.zl) alongside.

4. Postgres Insert
   - Use `pgx.CopyFrom` to stream records into `cleandata` tables (or a staging schema with merge into `cleandata`).
   - If `pg_parquet` with S3 URIs is confirmed on Crunchy Bridge, optionally switch to server-side load for bulk imports.

5. Containerize & Deploy
   - Dockerfile: multi-stage Go build, non-scratch runtime if bundling OpenZL; otherwise scratch + OpenZL sidecar.
   - Pulumi component `cluster/src/components/lsParquetEtl.ts` to deploy a `batch/v1` CronJob with:
     - AWS creds, HF token, Postgres URL from ESC.
     - `emptyDir` for `/tmp` workspace.
     - Resource requests small by default; bump if Parquet/OpenZL needs more CPU.

6. Monitoring & Evolution
   - Structured logs with counts, compression ratios, and timings.
   - Optional Prometheus metrics endpoint.
   - Schema evolution playbook: add columns, update mapping; versioned Parquet schema; guardrails for backward compatibility.

## Operational Details

### Environment Variables (ETL)

- `LISTEN_ADDR` (optional for on-demand HTTP run), default cron-only.
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_PREFIX`.
- `DATABASE_URL` (Crunchy Bridge – from ESC).
- `HF_TOKEN`, `HF_DATASET_REPO`.
- `OPENZL_ENABLED` (`true|false`), `OPENZL_SCHEMA_PATH` (optional if using schema-aware mode).
- `PARQUET_COMPRESSION` (`zstd` default), `BATCH_SIZE` for DB copy.

### Idempotency

- Maintain an `etl_runs` table recording: `s3_key`, `etag`, `processed_at`, `status`, `artifact_paths`, `row_counts`, `parquet_bytes`, `zl_bytes`.
- Skip processing if an object key+etag pair is already completed; allow reprocess on status != success.

### Failure Modes

- OpenZL failure → continue with Parquet only; emit alert.
- HF push failure → retry with backoff; keep artifacts in S3; mark run as partial.
- DB insert failure → stop and mark failed; retain logs and S3 artifacts for re-run.

## Risks & Mitigations

- Managed DB limitations: Server-side `COPY FROM '/path'` won’t work; use client-side `CopyFrom` or `pg_parquet` with S3 URIs if supported.
- OpenZL static packaging: Prefer sidecar to avoid glibc/linking issues; otherwise use a compatible non-scratch base.
- HF Git/LFS complexity: Avoid; use Hub HTTP API as with training worker.
- Schema drift: Treat Parquet and DB schemas as versioned; enforce compatibility checks and migration scripts.

## Open Questions (to confirm)

1. Crunchy Bridge: Is `pg_parquet` enabled and can it read directly from S3 URIs? If yes, provide IAM/IAM role details.
2. OpenZL: Must it be enabled from day one, or is a Parquet-only MVP acceptable while we validate gains?
3. HF datasets: Keep JSONL as training source of truth? Should ETL publish both JSONL and Parquet(.zl)?
4. S3 eventing: Start with CronJob polling, or do you already have S3→SQS/SNS wiring to trigger runs?
5. LS export samples: Provide representative JSON/CSV so we lock the mapping and Parquet schema upfront.

## Appendix

### Example Pseudocode (Go ETL)

```go
// main
for _, obj := range s3.ListNew(prefix) {
  tmp := s3.Download(obj)
  rows := parseLSExport(tmp)          // JSON/CSV → []Record (validated)
  parquetPath := writeParquet(rows)   // zstd compressed
  if openZLEnabled { zlPath = zlCompress(parquetPath) }
  hf.Push(parquetPath, zlPath, jsonlPath)
  db.CopyFrom(rows)                   // client-side bulk load
  state.MarkProcessed(obj, stats)
}
```

### Example HF Layout

```
dataset-repo/
vertical=maritime/schema-1.0.0/project-123/2025/10/07/03/batch-<uuid>.jsonl
  parquet/2025-10-07/project-123/export-abc.parquet
  parquet/2025-10-07/project-123/export-abc.parquet.zl
```

### K8s CronJob Sketch (Pulumi-generated)

```yaml
apiVersion: batch/v1
kind: CronJob
spec:
  schedule: "*/10 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          imagePullSecrets: [{ name: ghcr-creds }]
          restartPolicy: OnFailure
          volumes: [{ name: work, emptyDir: {} }]
          containers:
            - name: etl
              image: ghcr.io/goldfish-inc/oceanid/ls-parquet-etl:main
              env:
                - name: S3_BUCKET
                - name: S3_PREFIX
                - name: DATABASE_URL
                - name: HF_TOKEN
                - name: HF_DATASET_REPO
                - name: OPENZL_ENABLED
              volumeMounts: [{ name: work, mountPath: /tmp }]
            - name: openzl
              image: ghcr.io/…/openzl:latest
              volumeMounts: [{ name: work, mountPath: /tmp }]
```

### Alternate: PyArrow Conversion

If you opt for Python for conversion only:

```python
import pyarrow as pa, pyarrow.parquet as pq, pandas as pd
df = pd.read_json('export.json')
table = pa.Table.from_pandas(df)
pq.write_table(table, 'output.parquet', compression='zstd')
# OpenZL:
#   zl-compress output.parquet output.parquet.zl --schema schema.yaml
```

The Go ETL still handles S3 discovery, HF commits, and DB load.
