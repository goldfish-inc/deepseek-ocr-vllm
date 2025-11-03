# Reconciliation Harness

This directory houses the pandas → pipeline reconciliation assets.

## Layout

```
baseline/    # Legacy pandas "golden" outputs
current/     # Outputs generated from the Go CSV worker (Phase B)
diffs/       # Diff reports produced by the comparison harness (Phase B)
```

## Golden Baselines (Phase A)

- Source: `data/raw/vessels/RFMO/raw/*.csv`
- Cleaner: `scripts/legacy-pandas-cleaners/rfmo/local_clean_all.py`
- Generated: 2025-11-02 00:22:15Z
- Commit: generated on top of current `main`

| File | Output |
|------|--------|
| CCSBT_vessels_2025-08-26.csv | ccsbt_vessels_cleaned.csv |
| FFA_vessels_2025-08-26.csv | ffa_vessels_cleaned.csv |
| IATTC_vessels_2025-08-26.csv | iattc_vessels_cleaned.csv |
| ICCAT_vessels_2025-08-26.csv | iccat_vessels_cleaned.csv |
| IOTC_vessels_2025-08-26.csv | iotc_vessels_cleaned.csv |
| NAFO_vessels_2025-08-26.csv | nafo_vessels_cleaned.csv |
| NEAFC_vessels_2025-08-26.csv | neafc_vessels_cleaned.csv |
| NPFC_vessels_2025-08-26.csv | npfc_vessels_cleaned.csv |
| PNA_TUNA_2025-09-08.csv | pna_vessels_cleaned.csv |
| SPRFMO_vessels_2025-08-26.csv | sprfmo_vessels_cleaned.csv |
| WCPFC_vessels_2025-08-26.csv | wcpfc_vessels_cleaned.csv |

## Phase B/C (next)

- `scripts/reconciliation/phase_b_pipeline_run.sh`: run the Go CSV worker for all RFMO files and dump staging output.
- `scripts/reconciliation/phase_b_diff.py`: compare staging output vs baseline (cell by cell) and produce diff summaries.
- `scripts/reconciliation/run_phase_b.sh`: one-shot orchestrator (pipeline run + diff generation).

Diff reports should be written into `diffs/` and referenced from issue `#244`.
