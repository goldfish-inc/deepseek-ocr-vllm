# Release: RFMO Reconciliation Phase B (2025-11-03)

## Summary
- IATTC: 99.71% (101,899 / 102,195)
- NPFC: 99.80% (36,588 / 36,663)
- NEAFC: 99.58% (31,173 / 31,304)
- PR: #250 (merged 2025-11-03T17:42:04Z)

## Key Fixes
1. Export disambiguation for CSV vs XLSX in pipeline runner
2. Header canonicalization (uppercase + underscore) in diff harness
3. Column aliasing (e.g., `IMO_NUMBER` ⇄ `IMO`)
4. Case-insensitive `FLAG` comparison in diff harness
5. XLSX parser skips metadata sheets and selects data sheet

## Residual Differences (Expected)
- Date format normalization (e.g., `6/17/05` → `06-17-05`)
- Float precision extensions
- Country code normalization (e.g., `GBR` → `GB`)
- Apostrophe cleanup

## Artifacts
- `tests/reconciliation/diffs/_summary.csv`
- `tests/reconciliation/diffs/{iattc,npfc,neafc}_diff.csv`
- `tests/reconciliation/current/*_stage.csv`

## Follow-ups
- #247: Umbrella for remaining RFMOs
- #251: Upgrade Go to 1.24.8 (govulncheck)
