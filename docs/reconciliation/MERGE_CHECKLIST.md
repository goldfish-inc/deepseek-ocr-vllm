# Phase C Merge & Verification Checklist

## Pre-Merge Verification

### PR #263 (Join-Key + Null-Aware Metrics)

- [ ] **CI checks passing**
  - [ ] `reconciliation-guard` workflow (if triggered)
  - [ ] Unit tests passing
  - [ ] Pre-commit hooks passing
  - [ ] No merge conflicts with `main`

- [ ] **Code review completed**
  - [ ] Null-aware metrics implementation reviewed
  - [ ] CI guardrails configuration reviewed
  - [ ] Documentation completeness verified

- [ ] **PR comment updated**
  - [ ] Null-aware metrics summary visible
  - [ ] Real-world impact metrics documented
  - [ ] Next steps clearly outlined

---

## Merge Order (IMPORTANT)

### Option A: Merge #261 First (Recommended)

1. **Merge PR #261** (Unicode NFC normalization)
2. **Verify NFC deployment**:
   ```bash
   # Run NAFO to verify NFC preserves diacritics
   ONLY=NAFO PREFER_EXT=xlsx scripts/reconciliation/run_phase_b.sh

   # Check for diacritics mismatches (should be 0)
   grep -E "José|Nicolás|François" tests/reconciliation/diffs/nafo_diff.csv
   ```
3. **If NAFO ≥99%**: Remove `accent_insensitive_columns` from `diff_config.yaml`
4. **Merge PR #263** (join-key + null-aware metrics)

### Option B: Merge #263 First (Alternative)

1. **Merge PR #263** (join-key + null-aware metrics)
2. **Keep `accent_insensitive_columns`** in config until #261 merges
3. **Merge PR #261** (Unicode NFC normalization)
4. **Remove `accent_insensitive_columns`** after verifying NAFO ≥99%

---

## Post-Merge Verification

### 1. Run Full Reconciliation Batch

```bash
# Run all 11 RFMOs with null-aware metrics
PREFER_EXT=xlsx scripts/reconciliation/run_phase_b_batch.sh

# Validate results
python scripts/reconciliation/validate_reconciliation.py
# Expected: ✅ All reconciliation checks passed
```

### 2. Verify Key Metrics

**Expected Results** (from 2025-11-04 baseline):

| RFMO | Null-Aware Match Rate | Status |
|------|----------------------|--------|
| IATTC | 100.00% | ✅ |
| ICCAT | 99.99% | ✅ |
| NPFC | 99.98% | ✅ |
| FFA | 99.98% | ✅ |
| PNA | 99.66% | ✅ |
| SPRFMO | 99.95% | ✅ |
| WCPFC | 99.92% | ✅ |
| CCSBT | 99.05% | ✅ |
| NAFO | 97.50% | ✅ |
| NEAFC | 92.94% | ⚠️ |
| IOTC | 44.25% | ⚠️ (expected: high value mismatches) |

### 3. Validate CI Guard

```bash
# Test validation with custom thresholds
python scripts/reconciliation/validate_reconciliation.py \
  --threshold-file tests/reconciliation/validation_thresholds.yaml

# Expected: ✅ All reconciliation checks passed
```

### 4. Check Presence Metrics

```bash
# View per-RFMO summary
cat tests/reconciliation/diffs/_summary.csv

# View per-column presence for critical RFMOs
cat tests/reconciliation/diffs/iotc_presence.csv
cat tests/reconciliation/diffs/nafo_presence.csv
cat tests/reconciliation/diffs/pna_presence.csv
```

**Key Columns to Check**:
- `IMO`: Should have high coverage (>90% for most RFMOs)
- `NAME`: Should be 100% for all RFMOs
- `FLAG`/`FLAG_STATE_CODE`: Should be 100% for all RFMOs

### 5. Verify Information Gain/Loss

```bash
# Extract info_gain and info_loss from summary
grep -E "IOTC|NAFO|PNA" tests/reconciliation/diffs/_summary.csv | \
  awk -F',' '{print $1, "info_gain:", $11, "info_loss:", $12}'
```

**Expected Patterns**:
- **IOTC**: Balanced info_gain/info_loss (~109K each)
- **NAFO**: Minimal info_gain/info_loss (sparse data)
- **PNA**: After IMO mapping fix, info_gain should increase

---

## Post-NFC Cleanup (After #261 Merges)

### 1. Verify NFC Normalization Working

```bash
# Run NAFO with NFC enabled
ONLY=NAFO PREFER_EXT=xlsx scripts/reconciliation/run_phase_b.sh

# Check match rate (should be ≥99%)
grep nafo tests/reconciliation/diffs/_summary.csv
```

### 2. Remove Accent-Insensitive Workaround

**Edit `tests/reconciliation/diff_config.yaml`**:

```yaml
unicode:
  normalize: NFC  # Keep this
  accent_insensitive_columns: []  # Change from any values to empty list
```

### 3. Re-run Validation

```bash
# Full batch to confirm no regressions
PREFER_EXT=xlsx scripts/reconciliation/run_phase_b_batch.sh
python scripts/reconciliation/validate_reconciliation.py
```

### 4. Commit and Push

```bash
git add tests/reconciliation/diff_config.yaml
git commit -m "chore(reconciliation): remove accent_insensitive workaround after NFC deployment"
GIT_SSH_COMMAND="ssh -i ~/.ssh/claude-code-gh" git push origin main
```

---

## Known Issues & Follow-Up Tasks

### High Priority

1. **PNA IMO Mapping** (Issue #254)
   - **Current**: 0% IMO coverage (all cells empty)
   - **Expected**: 100% IMO coverage after pipeline fix
   - **Impact**: Symmetric baseline-only/pipeline-only counts should collapse with join-key
   - **Action**: Fix extraction rule to map IMO correctly

2. **NEAFC Value Mismatches** (92.94% match rate)
   - **Current**: ~10K changed_value cells
   - **Investigation needed**: Identify columns with mismatches
   - **Check**: `cat tests/reconciliation/diffs/neafc_presence.csv | sort -t',' -k14 -rn | head -20`

3. **IOTC Value Mismatches** (44.25% match rate)
   - **Current**: 6.3M changed_value cells
   - **Expected**: Structural differences (not extraction errors)
   - **Action**: Document expected mismatches per column

### Medium Priority

4. **Composite Join Keys** (Phase D)
   - **Design**: `[IMO, VESSEL_NAME]` fallback for missing IMO
   - **Impact**: Improve join coverage from 72.6% → 95%+ for IOTC/CCSBT
   - **Config addition**: `join_key.fallback` with composite key support

5. **Duplicate-Aware Join** (Phase D)
   - **Current**: Assumes IMO is unique (fails on duplicates)
   - **Proposed**: Auto-fallback to row_index when IMO duplicated
   - **Impact**: Handle rare edge cases (ships reusing IMO numbers)

### Low Priority

6. **Time-Series Tracking**
   - **Goal**: Track info_gain/info_loss over time
   - **Implementation**: Append to CSV or push to dashboard
   - **Use case**: Detect coverage regressions early

---

## Release Tagging

### After All Verifications Pass

```bash
# Tag release with descriptive name
git tag -a rfmo-phasec-2025-11-04 -m "$(cat <<'TAG_MESSAGE'
Phase C: Join-Key Alignment + Null-Aware Metrics

Features:
- Join-key row alignment with IMO (PR #263)
- Null-aware diff metrics (5 categories: match_value, match_null, info_gain, info_loss, changed_value)
- Per-RFMO null_aware_match_rate and per-column presence metrics
- CI guardrails with validate_reconciliation.py
- GitHub Actions integration (reconciliation-guard.yml)

Real-world impact:
- NAFO: 32.5% → 97.5% (both sides agree on sparse data)
- IOTC: +108,980 cells information gain
- Join-key coverage: Now accurate (72.6% vs misleading 100%)

Metrics:
- 11 RFMOs processed with null-aware metrics
- 6 RFMOs ≥99% match rate
- CI guard passing with 1% threshold

PRs:
- #261: Unicode NFC normalization
- #263: Join-key alignment + null-aware metrics

Next steps:
- Fix PNA IMO mapping (0% → 100% coverage)
- Remove accent_insensitive after NFC verification
- Implement composite join keys (Phase D)
TAG_MESSAGE
)"

# Push tag to remote
GIT_SSH_COMMAND="ssh -i ~/.ssh/claude-code-gh" git push origin rfmo-phasec-2025-11-04
```

### Update PHASE_C_SUMMARY.md

Add final results table with post-merge metrics.

---

## Success Criteria (All Must Pass)

- [ ] **CI guardrails active**: `reconciliation-guard.yml` workflow running on PRs
- [ ] **Validation passing**: `validate_reconciliation.py` exits with code 0
- [ ] **NAFO ≥99%**: After NFC + accent_insensitive removal
- [ ] **PNA symmetric collapse**: After IMO mapping fix (baseline-only = pipeline-only)
- [ ] **Documentation complete**: All metrics documented in PHASE_C_SUMMARY.md
- [ ] **Release tagged**: `rfmo-phasec-2025-11-04` with summary and PR links

---

## Troubleshooting

### If Validation Fails

1. **Check summary CSV**: `cat tests/reconciliation/diffs/_summary.csv`
2. **Identify failing RFMO**: Look for null_aware_match_rate drops
3. **Check presence CSV**: `cat tests/reconciliation/diffs/<rfmo>_presence.csv`
4. **Investigate diffs**: `cat tests/reconciliation/diffs/<rfmo>_diff.csv | head -100`

### If CI Workflow Fails

1. **Check workflow run**: `gh run view --log`
2. **Verify dependencies**: pandas, pyyaml, numpy installed
3. **Check artifact upload**: Ensure diffs directory exists
4. **Debug locally**: Run `phase_b_diff.py` and `validate_reconciliation.py` manually

### If Match Rates Drop

1. **Compare with baseline**: Check `validation_thresholds.yaml`
2. **Review recent changes**: `git log --oneline --since="1 week ago" -- apps/csv-ingestion-worker/`
3. **Check for extraction rule changes**: Pipeline modifications may affect match rates
4. **Update thresholds if justified**: Document why in commit message

---

## Contact & Support

- **Documentation**: `docs/reconciliation/null-aware-metrics.md`
- **Validation Script**: `scripts/reconciliation/validate_reconciliation.py --help`
- **Issues**: GitHub Issues with label `reconciliation`
- **Phase C Umbrella**: Issue #244

---

**Last Updated**: 2025-11-04
**Status**: Ready for merge and verification
