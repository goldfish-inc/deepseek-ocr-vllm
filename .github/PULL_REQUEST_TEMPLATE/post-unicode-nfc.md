## Post-Unicode NFC Cleanup (After PR #261 Merges)

**Context**: PR #261 implements Unicode NFC normalization in the extraction pipeline. Once deployed, the `accent_insensitive_columns` workaround in `diff_config.yaml` should be removed.

### Checklist

- [ ] Verify PR #261 is merged and deployed
- [ ] Run full reconciliation batch with NFC normalization:
  ```bash
  PREFER_EXT=xlsx scripts/reconciliation/run_phase_b_batch.sh
  ```
- [ ] Validate NAFO and other RFMOs with diacritics (e.g., "José", "Nicolás") maintain ≥99% match rate
- [ ] Remove `accent_insensitive_columns` from `diff_config.yaml`:
  ```yaml
  unicode:
    normalize: NFC  # Keep this
    accent_insensitive_columns: []  # Remove this workaround
  ```
- [ ] Re-run reconciliation to confirm no regressions:
  ```bash
  PREFER_EXT=xlsx scripts/reconciliation/run_phase_b_batch.sh
  python scripts/reconciliation/validate_reconciliation.py
  ```
- [ ] Update `PHASE_C_SUMMARY.md` to mark `accent_insensitive` as removed
- [ ] Commit and open PR with title: `chore(reconciliation): remove accent_insensitive workaround after NFC deployment`

### Expected Outcome

- **Before (with accent_insensitive)**: NAFO ≥99% (ignoring diacritics)
- **After (NFC only)**: NAFO ≥99% (preserving diacritics, NFC-normalized)

### Verification

```bash
# Check that NFC normalization is working correctly
grep -E "José|Nicolás|François" tests/reconciliation/diffs/nafo_diff.csv
# Should show 0 diacritics mismatches
```

If any diacritics mismatches appear, investigate pipeline NFC normalization before removing `accent_insensitive`.
