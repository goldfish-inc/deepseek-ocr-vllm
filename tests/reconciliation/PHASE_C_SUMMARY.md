# Phase C – RFMO Reconciliation Progress

This log tracks improvements from Phase C remediation (issues linked under #244).

## Legend
- Match Rate: percentage of cells matching between legacy pandas baselines and pipeline output
- Actions: rules/code updates applied to reach target

## ICCAT
- Before: 41.36% match, 737,143 mismatches (empty string vs "nan" differences)
- Actions:
  - Worker normalization of placeholder values to empty string (`processor.go`)
  - Diff harness preserves empty strings (`keep_default_na=False`)
- After: 99.99% match (~150 residual mismatches, e.g., trailing spaces)
- Issue: #246 (fixed & verified)

## IATTC (CSV/XLSX)
- Before: 0.00% match, only 1 row extracted (3,785 expected)
- Actions:
  - Parser skips metadata sheets and selects first data sheet (`parser.go`)
  - Export overwrite fixed: unique output per source (`phase_b_pipeline_run.sh`)
  - Diff harness canonicalizes headers and trims values; prefers XLSX (`phase_b_diff.py`)
  - Column aliasing: `IMO_NUMBER` ⇄ `IMO` (`phase_b_diff.py`)
  - Case-insensitive FLAG comparison (`phase_b_diff.py`)
- After: 99.71% match (101,899/102,195)
  - 296 residual mismatches: date format (288), float precision (7), apostrophe cleaning (1)
  - Parser fix validated: XLSX metadata sheets correctly skipped
- Issue: #245 (closed ✅)

## NPFC
- Before: 71.43% match (structural column differences)
- Actions:
  - Column name canonicalization (uppercase + underscore normalization)
  - Column aliasing via `ALIAS_MAP` in diff harness
- After: 99.80% match (36,588/36,663)
  - 75 residual mismatches: placeholder normalization `NONE` → empty (69), trailing quote removal (6)
- Issue: #248 (closed ✅)

## NEAFC
- Before: 83.32% match (close to target)
- Actions:
  - Column name canonicalization (uppercase + underscore normalization)
  - Column aliasing via `ALIAS_MAP` in diff harness
- After: 99.58% match (31,173/31,304)
  - 131 residual mismatches: country code normalization `GBR` → `GB` (ISO 3166-1 alpha-3 → alpha-2)
- Issue: #249 (closed ✅)

## Others (CCSBT, FFA, IOTC, NAFO, PNA, SPRFMO, WCPFC)
- Pattern: symmetric baseline-only vs pipeline-only cells (structural)
- Actions: track under #247 umbrella; apply header/case/empty handling and row filtering as needed

---

### Stage 5 Rollout Status
- Framework: config‑driven diff harness with aliases, case‑insensitive columns, and optional date/float/whitespace normalization
- Batch runner: `scripts/reconciliation/run_phase_b_batch.sh`
- Export race: fixed (wait for extractions to stabilize); verified with full CCSBT export (36,387 lines)
- Date normalization: enabled; dual‑scheme comparison (month‑first/day‑first) reduces IATTC mismatches from 289 → 1
- 2025‑11‑03T17:50Z batch (dates normalized): CCSBT, FFA, IATTC, ICCAT, IOTC, NAFO, NEAFC, NPFC, PNA
- 2025‑11‑03T17:33Z batch (dates not normalized): SPRFMO, WCPFC (temporary; to be re‑run with dates)
- Final summary regeneration may be skipped when local pandas/numpy are unavailable; batch script now warns and attempts a final refresh.

Last updated: 2025-11-03T17:55:00Z
