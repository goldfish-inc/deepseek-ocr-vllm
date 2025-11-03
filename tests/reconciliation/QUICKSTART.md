# Quickstart: RFMO Reconciliation

## Prerequisites
- CSV worker stack running locally (Postgres + MinIO + worker service)
- RFMO raw files present in `data/raw/vessels/RFMO/raw/`
- Golden baselines generated (see `baseline/vessels/RFMO/cleaned/`)
 - Optional: rebuild worker with version stamp
   ```bash
   scripts/reconciliation/rebuild_worker_image.sh
   ```

## Run Phase B
```bash
# All RFMOs
scripts/reconciliation/run_phase_b.sh

# Single RFMO (e.g., IATTC only)
ONLY=IATTC scripts/reconciliation/run_phase_b.sh

# Prefer a specific export when both CSV and XLSX exist
PREFER_EXT=xlsx scripts/reconciliation/run_phase_b.sh

# Override diff behavior via environment
CASE_INSENSITIVE_COLUMNS=FLAG,COUNTRY \
IGNORE_DATE_FORMATS=1 \
ROUND_FLOATS=4 \
scripts/reconciliation/run_phase_b.sh
```

This will:
1. Upload each RFMO raw file to MinIO and fire the webhook
2. Wait for the worker to finish and export `stage.csv_extractions` to `tests/reconciliation/current/`
3. Generate diff reports under `tests/reconciliation/diffs/`

## Inspect Results
- Summary CSV: `tests/reconciliation/diffs/_summary.csv`
- Per‑RFMO summaries: `tests/reconciliation/diffs/*_summary.txt`
- Detailed mismatches: `tests/reconciliation/diffs/*_diff.csv`

## Next Steps
- Update `stage.cleaning_rules` or thresholds for true mismatches.
- Re-run Phase B until outputs match expected behavior.
- Document findings and decisions in per‑RFMO issues and umbrella #247.

### Notes on Normalization
- The diff harness canonicalizes headers (uppercase + underscore) and aliases common columns (e.g., IMO vs IMO_NUMBER).
- `FLAG` is compared case‑insensitively to treat uppercase normalization as equivalent.
- Known benign transformations (date formatting, float precision) can be ignored via config/env toggles.
- Optional config file: `tests/reconciliation/diff_config.yaml` (aliases, case-insensitive columns, ignore rules).
