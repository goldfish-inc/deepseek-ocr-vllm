# Quickstart: RFMO Reconciliation

## Prerequisites
- CSV worker stack running locally (Postgres + MinIO + worker service)
- RFMO raw files present in `data/raw/vessels/RFMO/raw/`
- Golden baselines generated (see `baseline/vessels/RFMO/cleaned/`)

## Run Phase B
```bash
scripts/reconciliation/run_phase_b.sh
```

This will:
1. Upload each RFMO raw file to MinIO and fire the webhook
2. Wait for the worker to finish and export `stage.csv_extractions` to `tests/reconciliation/current/`
3. Generate diff reports under `tests/reconciliation/diffs/`

## Inspect Results
- Summary statistics: `tests/reconciliation/diffs/*.summary.txt`
- Detailed mismatches: `tests/reconciliation/diffs/*.diff.csv`

## Next Steps
- Update `stage.cleaning_rules` or thresholds for mismatches
- Re-run Phase B until output matches expected behavior
- Document findings in issue #244 (Phase C)
