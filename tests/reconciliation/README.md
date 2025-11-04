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
  - Optional config at `tests/reconciliation/diff_config.yaml` to control:
    - `aliases` map (column name equivalences)
    - `case_insensitive_columns` (e.g., FLAG)
    - `ignore_transformations` (date formats, float precision, whitespace)
  - Env toggles override config:
    - `CASE_INSENSITIVE_COLUMNS=FLAG,COUNTRY`
    - `IGNORE_DATE_FORMATS=1`
    - `ROUND_FLOATS=4`
    - `IGNORE_WHITESPACE=1`

- `scripts/reconciliation/run_phase_b.sh`
  - One-shot orchestrator (pipeline run + diff generation).

- Helpers
  - `scripts/reconciliation/rebuild_worker_image.sh`: no‑cache build with version stamp, then `docker compose up` stack.
  - `scripts/reconciliation/run_iattc_phase_b.sh`: run Phase B for IATTC only and print summary line.
  - `scripts/reconciliation/run_phase_b_batch.sh`: run Phase B for a set of RFMOs (defaults to CCSBT, FFA, IOTC, NAFO, PNA, SPRFMO, WCPFC). Override with `RFMO_LIST="CCSBT,FFA"`.

Diff reports are written into `diffs/` and referenced from issues (#245, #248, #249, umbrella #247).

### Interpreting Mismatches
- Expected transformations that may appear as diffs unless normalized:
  - Date formatting (e.g., `6/17/05` → `06-17-05`)
  - Floating‑point precision extensions (e.g., `44.74000168` → `44.7400016784668`)
  - Apostrophe cleanup (e.g., `Just Travlin'` → `Just Travlin`)
  - Country code normalization (e.g., `GBR` → `GB`)
  - Placeholder normalization (e.g., `NONE`/`null` → empty string)

See `tests/reconciliation/PHASE_C_SUMMARY.md` for per‑RFMO outcomes and notes.

## How to Reproduce Phase B Results

### Quick Start

```bash
# Full batch run (all 11 RFMOs with date normalization)
PREFER_EXT=xlsx scripts/reconciliation/run_phase_b_batch.sh

# Single RFMO
ONLY=IATTC PREFER_EXT=xlsx scripts/reconciliation/run_phase_b.sh

# Regenerate consolidated summary
scripts/reconciliation/phase_b_diff.py
```

### Environment Toggles

**File Format Preference:**
```bash
PREFER_EXT=xlsx  # Prefer XLSX over CSV when both exist (default)
PREFER_EXT=csv   # Prefer CSV over XLSX
```

**RFMO Selection:**
```bash
ONLY=IATTC                    # Single RFMO
RFMO_LIST="IATTC,ICCAT,NAFO"  # Subset (batch script only)
```

**Normalization Overrides:**
```bash
IGNORE_DATE_FORMATS=1              # Enable date normalization (dual-scheme)
CASE_INSENSITIVE_COLUMNS=FLAG      # Case-insensitive comparison
ROUND_FLOATS=4                     # Float precision tolerance
IGNORE_WHITESPACE=1                # Ignore leading/trailing whitespace
```

### Expected Output

**Summary file:** `tests/reconciliation/diffs/_summary.csv`
```csv
Generated: 2025-11-04T00:00:49.240123Z
baseline_file,current_file,total_cells,matched,baseline_only,pipeline_only,mismatched,match_rate
iattc_vessels_cleaned.csv,IATTC_vessels_2025-08-26_xlsx_stage.csv,102195,102194,0,0,1,1.0000
...
```

**Individual diffs:** `tests/reconciliation/diffs/{rfmo}_diff.csv`
```csv
row_index,column_name,baseline_value,pipeline_value,confidence,needs_review,rule_chain
19,NAME,PLAYA MENDUIÑA,PLAYA MENDUIA,0.675,t,{6}
...
```

### Troubleshooting

**Export race condition** (partial exports):
- Symptom: Row counts don't match expected (e.g., 1 row instead of 3,785)
- Solution: Script now waits for extraction count to stabilize (fixed in ca23dd4)

**AttributeError: Can only use .dt accessor**:
- Symptom: Error in phase_b_diff.py:206
- Solution: Fixed in a917883 (dtype check before .dt accessor)

**Summary not regenerating**:
- Symptom: `_summary.csv` shows old timestamp
- Solution: Ensure pandas/numpy installed: `pip install pandas numpy`

### Phase B Baseline (rfmo-phaseb-2025-11-03)

**Overall Results:**
- Total cells: 1,953,639
- Overall match rate: 98.54%
- 6 RFMOs ≥99% (IATTC, ICCAT, SPRFMO, NPFC, NEAFC, FFA)

**Key Features:**
- Dual-scheme date normalization (month-first + day-first)
- Config-driven aliases and case-insensitive columns
- Stable export with race condition protection
- Batch processing with continue-on-error resilience

See [release notes](https://github.com/goldfish-inc/oceanid/releases/tag/rfmo-phaseb-2025-11-03) for detailed results.
