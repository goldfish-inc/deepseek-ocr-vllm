# Phase B: Export function may silently fail for some RFMOs

Status: Open
Priority: High (blocks reliable batch runs in Stage 5)

## Summary
In `scripts/reconciliation/phase_b_pipeline_run.sh`, the `export_extractions` step occasionally produces empty or missing `*_stage.csv` files for certain RFMOs, without a clear error surfaced to the caller. This leads to missing `current/*_stage.csv` files and incomplete diffs.

## Suspected Causes
- `docker exec ... psql -c "\\COPY (...) TO STDOUT WITH CSV HEADER" > file.csv` may return non‑zero but stderr is not captured, or the redirection masks failures.
- `wait_for_document` may time out inconsistently, returning an empty `document_id` path in rare cases.
- Quoting/escaping in the SQL filter (by `file_name`) may fail for filenames with special characters.

## Repro Steps
1. Ensure local stack is running: `scripts/reconciliation/rebuild_worker_image.sh`
2. Run a specific RFMO that previously failed: `ONLY=<RFMO> scripts/reconciliation/run_phase_b.sh`
3. Inspect `tests/reconciliation/current/` for a corresponding `*_stage.csv` file.

## Proposed Fixes
1. Harden export with strict error handling and post‑checks:
   - Add `set -o pipefail` and check `psql` exit code.
   - Capture stderr to a log and echo on non‑zero exit.
   - Verify output row count (`wc -l`) > 1 (header only) and warn if below threshold.
2. Improve `wait_for_document`:
   - Fail fast if `document_id` is empty; surface explicit timeout error per file.
   - Log the query used and the waited duration.
3. Filename safety:
   - Quote filename comparisons safely; consider parameterizing via `psql -v`.

## Acceptance Criteria
- Batch runs (`run_phase_b_batch.sh`) produce non‑empty `*_stage.csv` for all RFMOs or fail with a clear error.
- Exit codes propagate to the orchestrator; no silent success on failure.

## References
- scripts/reconciliation/phase_b_pipeline_run.sh:1
- scripts/reconciliation/run_phase_b_batch.sh:1
- tests/reconciliation/diff_config.yaml:1
