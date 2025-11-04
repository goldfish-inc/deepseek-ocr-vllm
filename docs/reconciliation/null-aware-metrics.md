# Null-Aware Reconciliation Metrics

## Philosophy: Null is Data

Traditional diff tools penalize all null/missing values uniformly, treating them as "bad data." For intelligence gathering, this is counterproductive:

- **Information gain** (baseline null → pipeline value) is *positive* — the pipeline filled a gap
- **Match null** (both null) is *valid signal* — both sources agree data is missing
- **Information loss** (baseline value → pipeline null) is *negative* — data was lost

The null-aware diff harness treats missing data as a **first-class signal**, enabling:
1. Measuring information gain/loss per RFMO and per column
2. Tracking coverage improvements (or regressions)
3. Distinguishing semantic null types (`not_applicable` vs `unknown` vs `not_provided`)

---

## Configuration

### Null Tokens (`tests/reconciliation/diff_config.yaml`)

```yaml
null_values:
  # Tokens normalized to canonical <NULL> before comparison
  - ""
  - "N/A"
  - "NA"
  - "NONE"
  - "NULL"
  - "—"
  - "-"
  - "Not Available"
  - "Unknown"

null_categories:
  # Semantic mapping (preserves "why null" signal)
  "N/A": "not_applicable"
  "NA": "not_applicable"
  "Not Available": "not_available"
  "NONE": "unknown"
  "NULL": "unknown"
  "Unknown": "unknown"
  "—": "not_provided"
  "-": "not_provided"

null_policy:
  # Scoring policy for null_aware_match_rate
  count_match_null_as_positive: true    # Both null = valid match
  count_info_gain_as_positive: true     # Baseline null → pipeline value = gain
  count_info_loss_as_negative: true     # Baseline value → pipeline null = loss
```

---

## Diff Classification (5 Categories)

For each cell pair (baseline, pipeline), the harness classifies into one of:

| Category | Baseline | Pipeline | Interpretation | Score |
|----------|----------|----------|----------------|-------|
| **`match_value`** | Non-null | Non-null (same) | Exact value match | ✅ Positive |
| **`match_null`** | Null | Null | Both agree data is missing | ✅ Positive |
| **`info_gain`** | Null | Non-null | Pipeline filled a gap | ✅ Positive |
| **`info_loss`** | Non-null | Null | Data was lost | ❌ Negative |
| **`changed_value`** | Non-null | Non-null (different) | Value mismatch | ❌ Negative |

### Null-Aware Match Rate

Computed as:
```python
positive = count_match_value + count_match_null + count_info_gain  # Default policy
negative = count_changed_value + count_info_loss  # Default policy
null_aware_match_rate = positive / (positive + negative)
```

Configurable via `null_policy` (see above).

---

## Metrics Exported

### 1. Per-RFMO Summary (`tests/reconciliation/diffs/_summary.csv`)

```csv
baseline_file,current_file,total_cells,matched,baseline_only,pipeline_only,mismatched,match_rate,null_aware_match_rate,count_match_value,count_match_null,count_info_gain,count_info_loss,count_changed_value
iotc_vessels_cleaned.csv,IOTC_vessels_2025-08-26_xlsx_stage.csv,11524198,4985532,5321,5321,6528024,0.4326,0.4425,3719194,1266338,108980,108980,6310064
nafo_vessels_cleaned.csv,NAFO_vessels_2025-08-26_xlsx_stage.csv,960,312,320,320,8,0.3250,0.9750,298,14,0,0,8
```

**Key Columns:**
- `match_rate`: Traditional (exact value matches only)
- `null_aware_match_rate`: Includes null semantics (higher is better when nulls are valid)
- `count_match_null`: Both sides null (valid signal)
- `count_info_gain`: Baseline null → pipeline value (positive)
- `count_info_loss`: Baseline value → pipeline null (negative)
- `count_changed_value`: Value mismatches

**Example Interpretation (NAFO):**
- Traditional `match_rate`: 32.5% (penalizes all nulls)
- Null-aware `match_rate`: 97.5% (recognizes both sides agree on missing data)
- Insight: Pipeline correctly extracts sparse NAFO data; low cell counts are structural (small fleet)

### 2. Per-Column Presence (`tests/reconciliation/diffs/<rfmo>_presence.csv`)

```csv
column_name,baseline_non_null_count,baseline_non_null_pct,pipeline_non_null_count,pipeline_non_null_pct,delta_pct,match_value,match_null,info_gain,info_loss,changed_value
IMO,318362,99.54,318362,99.54,0.0,0,0,0,0,0
OPERATING_COMPANY,171663,53.67,171663,53.67,0.0,0,0,0,0,0
GROSS_TONNAGE,0,0.0,0,0.0,0.0,0,0,0,0,0
```

**Key Columns:**
- `baseline_non_null_pct`: % non-null in baseline (coverage)
- `pipeline_non_null_pct`: % non-null in pipeline (coverage)
- `delta_pct`: Coverage change (pipeline - baseline)
  - **Positive delta**: Pipeline has better coverage (information gain)
  - **Negative delta**: Pipeline has worse coverage (information loss)
- Per-category counts: Breakdown of 5 diff classes for this column

**Example Use Cases:**
- Identify columns with low coverage (e.g., `GROSS_TONNAGE: 0%` → optional field)
- Track coverage improvements (e.g., `delta_pct > 0` → pipeline fills gaps)
- Detect regressions (e.g., `delta_pct < -10%` → extraction rule broken)

---

## CI Guard Thresholds

`scripts/reconciliation/validate_reconciliation.py` enforces quality gates:

### Critical Failures (exit code 1)
- **Match rate regression**: `null_aware_match_rate` drops >5% for any RFMO
- **Critical column coverage drop**: IMO, NAME, FLAG coverage drops >10%

### Warnings (exit code 2)
- **Non-critical coverage drop**: Any column coverage drops >10%
- **Minor match rate regression**: <5% drop

### Usage

```bash
# Run after phase_b_diff.py
python scripts/reconciliation/validate_reconciliation.py

# Custom thresholds
python scripts/reconciliation/validate_reconciliation.py --threshold-file custom_thresholds.yaml
```

**Example Output:**
```
✅ All reconciliation checks passed
```

Or:
```
❌ CRITICAL FAILURES:
  - IOTC: null_aware_match_rate dropped 8.50% (0.4425 → 0.3550), threshold: 5.0%
  - [CRITICAL] PNA.IMO: coverage dropped 45.00% (100.00% → 55.00%)

⚠️  WARNINGS:
  - NEAFC: null_aware_match_rate dropped 2.10% (0.9294 → 0.9100)
  - SPRFMO.OPERATING_COMPANY: coverage dropped 12.00% (65.00% → 53.00%)

❌ 2 critical failure(s), 2 warning(s)
```

---

## Join-Key Coverage Fix

Empty strings are now treated as null when calculating join-key coverage:

**Before (bug):**
```
IOTC: join_key coverage: baseline=100.0%, pipeline=100.0%
# Misleading: "" counted as "present"
```

**After (fixed):**
```
IOTC: join_key coverage: baseline=72.6%, pipeline=72.6%
# Accurate: only non-empty IMO values count
```

This fixes symmetric `baseline_only`/`pipeline_only` mismatches for RFMOs with sparse IMO coverage (IOTC, CCSBT, PNA).

---

## Real-World Examples

### NAFO: High Null-Aware Match (Both Agree on Sparse Data)

```
Traditional match_rate: 32.5%  ❌ Misleading (penalizes nulls)
Null-aware match_rate: 97.5%  ✅ Accurate (both sides agree on missing data)

count_match_value: 298
count_match_null: 14   ← Both sides null (valid signal)
count_changed_value: 8
```

**Insight**: Pipeline correctly extracts NAFO's sparse fleet data. Low cell counts are structural (small fleet), not extraction errors.

### IOTC: Information Gain Visible

```
count_info_gain: 108,980   ← Baseline null → pipeline value
count_info_loss: 108,980   ← Baseline value → pipeline null

delta_pct (avg across columns): ~0%  (balanced gain/loss)
```

**Insight**: Pipeline fills ~109K cells baseline lacks, but also loses ~109K cells baseline has. Drill into presence CSV to identify which columns gain vs lose coverage.

### WCPFC: Critical Coverage Loss Detected

```
WCPFC.IMO: delta_pct = -15.0%  ← Coverage dropped 15%
```

**Action**: CI guard triggers critical failure. Investigation reveals extraction rule regression → rollback or fix before merge.

---

## Best Practices

1. **Always run validation** after reconciliation:
   ```bash
   PREFER_EXT=xlsx scripts/reconciliation/run_phase_b_batch.sh
   python scripts/reconciliation/validate_reconciliation.py
   ```

2. **Monitor presence CSVs** for:
   - Columns with `delta_pct > 10%` (significant coverage changes)
   - Critical fields (IMO, NAME, FLAG) with `pipeline_non_null_pct < 90%`

3. **Use null categories** in extraction rules:
   ```go
   // Preserve semantic nulls
   if isOptionalField && value == "" {
       return Cell{Value: "N/A", NullReason: "not_applicable"}
   }
   ```

4. **Tune thresholds** per RFMO:
   - High-coverage RFMOs (NEAFC, NPFC): Strict thresholds (<2% regression)
   - Sparse RFMOs (NAFO, PNA): Lenient thresholds (<10% regression)

5. **Track information gain** over time:
   - Export `count_info_gain` and `count_info_loss` to time-series metrics
   - Alert on sustained negative trends (more loss than gain)

---

## Next Steps: Composite Keys (Phase D)

Current limitation: Single `join_key` (IMO only). Fails when:
- IMO is missing (IOTC: 27.4% of rows)
- IMO is duplicated (rare but breaks alignment)

**Proposed enhancement:**
```yaml
join_key:
  primary: IMO
  fallback:
    - [IMO, VESSEL_NAME]  # Composite key for missing IMO
    - [VESSEL_NAME, FLAG_STATE_CODE]  # Final fallback
```

This will collapse remaining symmetric mismatches and improve join coverage from 72.6% → 95%+.

---

## References

- Implementation: `scripts/reconciliation/phase_b_diff.py:137-625`
- Configuration: `tests/reconciliation/diff_config.yaml`
- Validation: `scripts/reconciliation/validate_reconciliation.py`
- Summary: `tests/reconciliation/PHASE_C_SUMMARY.md`
