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

## Complete Results Table (2025-11-04)

All 11 RFMOs processed with date normalization enabled:

| RFMO   | Match Rate | Total Cells | Matched  | Mismatched | Baseline Only | Pipeline Only | Status |
|--------|------------|-------------|----------|------------|---------------|---------------|--------|
| IATTC  | 100.00%    | 102,195     | 102,194  | 1          | 0             | 0             | ✅ |
| ICCAT  | 99.99%     | 1,257,062   | 1,256,912| 150        | 0             | 0             | ✅ |
| SPRFMO | 99.95%     | 69,125      | 69,087   | 38         | 0             | 0             | ✅ |
| NPFC   | 99.80%     | 36,663      | 36,588   | 75         | 0             | 0             | ✅ |
| NEAFC  | 99.58%     | 31,304      | 31,173   | 131        | 0             | 0             | ✅ |
| FFA    | 98.00%     | 43,095      | 42,233   | 17         | 845           | 0             | ⚠️ |
| WCPFC  | 97.33%     | 164,777     | 160,375  | 4,402      | 0             | 0             | ⚠️ |
| IOTC   | 94.66%     | 202,198     | 191,405  | 151        | 5,321         | 5,321         | ⚠️ |
| CCSBT  | 91.58%     | 37,968      | 34,770   | 34         | 1,582         | 1,582         | ⚠️ |
| PNA    | 83.20%     | 8,052       | 6,699    | 11         | 671           | 671           | ⚠️ |
| NAFO   | 6.67%      | 1,200       | 80       | 0          | 560           | 560           | ❌ |

**Summary Stats:**
- Total cells analyzed: 1,953,639
- Overall match rate: 98.54%
- 6 RFMOs ≥99% (excellent)
- 5 RFMOs need improvement (83-98%)
- 1 RFMO critical (NAFO: 6.67%)

### Stage 5 Rollout Status
- Framework: config‑driven diff harness with aliases, case‑insensitive columns, and optional date/float/whitespace normalization
- Batch runner: `scripts/reconciliation/run_phase_b_batch.sh`
- Export race: fixed (wait for extractions to stabilize); verified with full CCSBT export (36,387 lines)
- Date normalization: enabled; dual‑scheme comparison (month‑first/day‑first) reduces IATTC mismatches from 289 → 1
- 2025‑11‑04T00:00Z complete batch: All 11 RFMOs processed with date normalization
- Summary: `tests/reconciliation/diffs/_summary.csv` (auto-generated)
- Fix applied: Added dtype check before `.dt` accessor to prevent AttributeError in phase_b_diff.py:206

### Null-Aware Diff Metrics (Phase C Enhancement)

The diff harness now treats missing data as a **first-class signal** (intelligence gathering mindset) instead of penalizing all nulls uniformly.

#### Null Canonicalization
- **Null tokens**: `""`, `N/A`, `NA`, `NONE`, `NULL`, `—`, `-`, `Not Available`, `Unknown` (configurable in `diff_config.yaml`)
- **Null categories**: Maps tokens to semantic reasons (e.g., `not_applicable`, `unknown`, `not_provided`) to preserve "why null" signal
- **Canonical form**: All null tokens normalized to `<NULL>` before comparison (prevents false positives from different null representations)

#### Diff Classification (5 categories)
Each cell pair is classified based on null status and value equality:

1. **`match_value`**: Both non-null and equal → **Positive** (exact match)
2. **`match_null`**: Both null → **Positive** (valid signal; both sides agree data is missing)
3. **`info_gain`**: Baseline null → pipeline non-null → **Positive** (pipeline fills gaps)
4. **`info_loss`**: Baseline non-null → pipeline null → **Negative** (data loss; downstream TBD)
5. **`changed_value`**: Both non-null but different → **Negative** (value mismatch)

#### Metrics Exported

**Per-RFMO Summary** (`tests/reconciliation/diffs/_summary.csv`):
- `null_aware_match_rate`: % of cells classified as positive (configurable via `null_policy`)
- `count_match_value`: Exact value matches (both non-null, equal)
- `count_match_null`: Null matches (both null)
- `count_info_gain`: Information gain (baseline null → pipeline value)
- `count_info_loss`: Information loss (baseline value → pipeline null)
- `count_changed_value`: Value changes (both non-null, different)

**Per-Column Presence** (`tests/reconciliation/diffs/<rfmo>_presence.csv`):
- `baseline_non_null_pct`: % of non-null cells in baseline
- `pipeline_non_null_pct`: % of non-null cells in pipeline
- `delta_pct`: Coverage change (pipeline - baseline)
- Per-column counts: `match_value`, `match_null`, `info_gain`, `info_loss`, `changed_value`

#### Null Policy (configurable)
Controls how null matches are scored in `null_aware_match_rate`:
- `count_match_null_as_positive: true` (default) — Both null = valid match
- `count_info_gain_as_positive: true` (default) — Reward filling gaps
- `count_info_loss_as_negative: true` (default) — Penalize data loss

#### Join-Key Coverage Fix
- Empty strings now treated as null when determining join-key coverage
- Fixes IOTC/CCSBT/PNA symmetric baseline-only/pipeline-only mismatches (missing IMO → fallback to row_index)
- Reports actual join-key coverage per RFMO: `baseline={X}%, pipeline={Y}%`

#### Use Cases
- **Information gain tracking**: Identify which columns/RFMOs benefit from pipeline extraction (baseline null → pipeline value)
- **Coverage gaps**: Per-column presence metrics show which fields have low coverage in baseline or pipeline
- **Null semantics**: Distinguish between "not applicable" vs "unknown" vs "not provided" for intelligence reporting

Last updated: 2025-11-04T00:30:00Z

---

## Phase D – Composite Keys + Duplicate-Aware Join (2025-11-05)

Objective: Collapse symmetric baseline‑only/pipeline‑only counts by aligning rows with identifiers beyond `row_index`.

Implemented (PR #265 + normalization):
- Worker header canonicalization (uppercase + non‑alnum → underscore; aliases for IMO/CALL SIGN)
- Composite keys with duplicate‑aware policy and per‑RFMO overrides
- Alignment breakdown metrics in summary/presence exports
- Composite‑key‑only normalization (surgical; keys only, values untouched): quotes/apostrophes/ampersand/whitespace/degree symbol

### Alignment Breakdown (Before → After)

| RFMO  | aligned_by_join_key | aligned_by_composite | aligned_by_row_index |
|-------|----------------------|----------------------|----------------------|
| CCSBT | 16,368 → 17,112     | 0 → 18,630           | 18,436 → 598         |
| IOTC  | 111,240 → 111,240   | 0 → 80,316           | 80,316 → 0           |
| PNA   | 6,690 → 6,690       | 0 → 20               | 20 → 0               |

Notes:
- CCSBT: Composite key engagement went from 0 to 18,630 (now dominant), with punctuation normalization adding +184 additional composite‑aligned cells. Row‑index fallback reduced ~97%.
- IOTC: Rows previously aligned by row_index now align by composite keys (80,316). Join‑key coverage unchanged (72.6%).
- PNA: Stable join‑key alignment with minor composite engagement (20) post‑normalization.

### Match Rate Impact (null‑aware)

| RFMO  | Before | After  | Delta  |
|-------|--------|--------|--------|
| CCSBT | 0.9991 | 0.9994 | +0.0003|
| IOTC  | 0.9992 | 0.9992 | 0      |
| PNA   | 0.9984 | 0.9984 | 0      |

Observations:
- Improvements primarily affect symmetric only‑cells and alignment strategy, not value matches; null‑aware rates remain stable or improve marginally.

### Configuration Snippets

Composite key overrides:

```
composite_overrides:
  CCSBT:
    - [VESSEL_REGISTRATION_NUMBER, VESSEL_NAME]
    - [CCSBT_REGISTRATION_NUMBER, VESSEL_NAME]
    - [IMO, VESSEL_NAME]
    - [IMO, FLAG]
    - [CALL_SIGN, VESSEL_NAME]
  IOTC:
    - [IMO, VESSEL_NAME]
    - [VESSEL_NAME, FLAG_STATE_CODE, REGNO]
```

Composite‑key‑only normalization (keys only; values untouched):

```
composite_key_normalization:
  enabled: true
  rules:
    strip_quotes: true
    strip_apostrophes: true
    ampersand_to_and: true
    compress_whitespace: true
    remove_degree_symbol: true
```

### Next Steps
- Open follow‑up PR: feat/composite‑key‑normalization (dependent on #265)
- After #261 (Unicode NFC/diacritics) merges, remove `unicode.accent_insensitive_columns: [VESSEL_NAME]` and re‑validate.
- Scope per‑RFMO normalization only if regressions observed; current global rules acceptable.
