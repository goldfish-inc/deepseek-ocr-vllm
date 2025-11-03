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

## Phase B/C (pipeline + diff)

- `scripts/reconciliation/phase_b_pipeline_run.sh`
  - Runs the Go CSV worker for all RFMO files and exports `stage.csv_extractions`.
  - Writes unique exports per source to avoid collisions, e.g. `*_csv_stage.csv`, `*_xlsx_stage.csv`.
  - Supports `ONLY=<RFMO>` to run a single source (e.g., `ONLY=IATTC`).

- `scripts/reconciliation/phase_b_diff.py`
  - Compares pipeline exports vs golden baselines (cell-by-cell) and produces diff summaries.
  - Canonicalizes headers (uppercase + non-alnum → underscore) to align baseline vs pipeline.
  - Aliases common columns (e.g., `IMO_NUMBER` ⇄ `IMO`).
  - Case-insensitive compare for `FLAG` to treat intentional uppercasing as equivalent.
  - Prefers XLSX export when both CSV and XLSX exist; override with `PREFER_EXT=csv|xlsx`.

- `scripts/reconciliation/run_phase_b.sh`
  - One-shot orchestrator (pipeline run + diff generation).

- Helpers
  - `scripts/reconciliation/rebuild_worker_image.sh`: no‑cache build with version stamp, then `docker compose up` stack.
  - `scripts/reconciliation/run_iattc_phase_b.sh`: run Phase B for IATTC only and print summary line.

Diff reports are written into `diffs/` and referenced from issues (#245, #248, #249, umbrella #247).

### Interpreting Mismatches
- Expected transformations that may appear as diffs unless normalized:
  - Date formatting (e.g., `6/17/05` → `06-17-05`)
  - Floating‑point precision extensions (e.g., `44.74000168` → `44.7400016784668`)
  - Apostrophe cleanup (e.g., `Just Travlin'` → `Just Travlin`)
  - Country code normalization (e.g., `GBR` → `GB`)
  - Placeholder normalization (e.g., `NONE`/`null` → empty string)

See `tests/reconciliation/PHASE_C_SUMMARY.md` for per‑RFMO outcomes and notes.
