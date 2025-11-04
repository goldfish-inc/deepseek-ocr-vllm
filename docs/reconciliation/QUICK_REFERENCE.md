# Null-Aware Reconciliation - Quick Reference

**Version**: Phase C (2025-11-04)
**PR**: [#263](https://github.com/goldfish-inc/oceanid/pull/263)
**Full Docs**: `docs/reconciliation/null-aware-metrics.md`

---

## 🚀 Quick Start

### Run Reconciliation (All RFMOs)

```bash
# Preferred: XLSX exports with null-aware metrics
PREFER_EXT=xlsx scripts/reconciliation/run_phase_b_batch.sh

# Validate results (CI guard)
python scripts/reconciliation/validate_reconciliation.py
# ✅ All reconciliation checks passed
```

### Single RFMO

```bash
# Run specific RFMO
ONLY=IOTC PREFER_EXT=xlsx scripts/reconciliation/run_phase_b.sh

# View results
cat tests/reconciliation/diffs/_summary.csv | grep -i iotc
cat tests/reconciliation/diffs/iotc_presence.csv
```

---

## 📊 Understanding Null-Aware Metrics

### The 5 Categories

Every cell pair is classified as one of:

| Category | Baseline | Pipeline | Score | Meaning |
|----------|----------|----------|-------|---------|
| **match_value** | Non-null | Same | ✅ Positive | Exact match |
| **match_null** | Null | Null | ✅ Positive | Both agree: missing |
| **info_gain** | Null | Non-null | ✅ Positive | Pipeline fills gap |
| **info_loss** | Non-null | Null | ❌ Negative | Data lost |
| **changed_value** | Non-null | Different | ❌ Negative | Value mismatch |

### Null Tokens (Auto-Normalized to `<NULL>`)

```yaml
""  N/A  NA  NONE  NULL  —  -  Not Available  Unknown
```

---

## 📁 Output Files

### Per-RFMO Summary (`diffs/_summary.csv`)

```csv
baseline_file,current_file,total_cells,matched,baseline_only,pipeline_only,mismatched,match_rate,null_aware_match_rate,count_match_value,count_match_null,count_info_gain,count_info_loss,count_changed_value
nafo_vessels_cleaned.csv,NAFO_...,960,312,320,320,8,0.3250,0.9750,298,14,0,0,8
```

**Key Columns**:
- `match_rate`: Traditional (exact values only)
- `null_aware_match_rate`: Includes null semantics
- `count_match_null`: Both null (valid)
- `count_info_gain`: Baseline null → pipeline value
- `count_info_loss`: Baseline value → pipeline null

### Per-Column Presence (`diffs/<rfmo>_presence.csv`)

```csv
column_name,baseline_non_null_pct,pipeline_non_null_pct,delta_pct,match_value,match_null,info_gain,info_loss,changed_value
IMO,99.54,99.54,0.0,0,0,0,0,0
OPERATING_COMPANY,53.67,53.67,0.0,0,0,0,0,0
```

**Key Columns**:
- `delta_pct`: Coverage change (pipeline - baseline)
  - Positive = Pipeline has better coverage
  - Negative = Pipeline has worse coverage
- Per-category counts: Breakdown by diff class

---

## ⚠️ CI Guard Thresholds

### Critical Failures (Exit Code 1)

- Match rate drops **>1%** for any RFMO
- Critical column (IMO, NAME, FLAG) coverage drops **>10%**

### Warnings (Exit Code 2)

- Non-critical column coverage drops **>5%**

### Custom Thresholds

```bash
python scripts/reconciliation/validate_reconciliation.py \
  --threshold-file tests/reconciliation/validation_thresholds.yaml
```

---

## 🔍 Common Queries

### Find Columns with Biggest Coverage Change

```bash
# Sort by delta_pct (descending)
cat tests/reconciliation/diffs/iotc_presence.csv | \
  awk -F',' 'NR==1 || $6 != 0 {print}' | \
  sort -t',' -k6 -rn | head -20
```

### Find RFMOs with High Info Loss

```bash
# Extract info_loss column
awk -F',' 'NR>2 {split($1,a,"_"); print a[1], "info_loss:", $12}' \
  tests/reconciliation/diffs/_summary.csv | \
  sort -t':' -k2 -rn
```

### Check Join-Key Coverage

```bash
# Run diff and grep for coverage lines
ONLY=IOTC PREFER_EXT=xlsx scripts/reconciliation/run_phase_b.sh 2>&1 | \
  grep "join_key coverage"
# Expected: [INFO] IOTC: join_key coverage: baseline=72.6%, pipeline=72.6%
```

---

## 🐛 Troubleshooting

### "Validation failed" Error

1. **Check which RFMO failed**:
   ```bash
   python scripts/reconciliation/validate_reconciliation.py 2>&1 | \
     grep "CRITICAL\|WARNING"
   ```

2. **View detailed summary**:
   ```bash
   cat tests/reconciliation/diffs/_summary.csv
   ```

3. **Investigate specific RFMO**:
   ```bash
   cat tests/reconciliation/diffs/<rfmo>_presence.csv | \
     sort -t',' -k6 -n  # Sort by delta_pct
   ```

### "No pipeline output found" Warning

- Check if extraction completed:
  ```bash
  ls -lh tests/reconciliation/current/<RFMO>*_stage.csv
  ```

- Re-run pipeline:
  ```bash
  ONLY=<RFMO> scripts/reconciliation/phase_b_pipeline_run.sh
  ```

### High Mismatch Count

1. **Check if structural** (baseline-only vs pipeline-only):
   - If symmetric (same count): Likely row ordering issue
   - If asymmetric: Likely extraction issue

2. **Check join-key coverage**:
   ```bash
   grep "join_key coverage" tests/reconciliation/diffs/*.txt
   ```

3. **Review presence metrics**:
   ```bash
   cat tests/reconciliation/diffs/<rfmo>_presence.csv
   ```

---

## 📖 Real-World Examples

### NAFO: Sparse Data Recognition

**Before** (traditional): 32.5% ❌
**After** (null-aware): 97.5% ✅

**Insight**: Both baseline and pipeline correctly represent sparse NAFO fleet data. Low cell counts are structural, not errors.

### IOTC: Information Gain Tracking

**Info Gain**: +108,980 cells (baseline null → pipeline value)
**Info Loss**: -108,980 cells (baseline value → pipeline null)

**Insight**: Balanced gain/loss. Pipeline fills gaps in some columns but loses data in others. Presence CSV shows exactly which columns.

### PNA: Join-Key Collapse (After IMO Fix)

**Before**: baseline_only=671, pipeline_only=671 (symmetric)
**After**: baseline_only=0, pipeline_only=0 (collapsed with join-key)

**Insight**: Symmetric mismatches caused by row reordering. Join-key alignment fixes this once IMO mapping is corrected.

---

## 🔧 Configuration

### Null Values (`diff_config.yaml`)

```yaml
null_values:
  - ""
  - "N/A"
  - "NA"
  - "NONE"
  - "NULL"
  - "—"
  - "-"
  - "Not Available"
  - "Unknown"
```

### Null Policy

```yaml
null_policy:
  count_match_null_as_positive: true     # Both null = valid
  count_info_gain_as_positive: true      # Reward filling gaps
  count_info_loss_as_negative: true      # Penalize data loss
```

### Join Key

```yaml
join_key: IMO  # Row alignment by IMO number

aliases:
  IMO_NUMBER: IMO
  IMO_NO: IMO
  IMO_NO_: IMO
```

---

## 📞 Support

- **Full Documentation**: `docs/reconciliation/null-aware-metrics.md`
- **Merge Checklist**: `docs/reconciliation/MERGE_CHECKLIST.md`
- **Validation Help**: `python scripts/reconciliation/validate_reconciliation.py --help`
- **GitHub Issues**: Tag with `reconciliation`

---

**Last Updated**: 2025-11-04
**Status**: Production-ready (PR #263)
