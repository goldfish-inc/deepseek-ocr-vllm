#!/usr/bin/env bash
set -euo pipefail

# Batch runner for Phase B across multiple RFMOs using the config‑driven harness.
# Usage:
#   scripts/reconciliation/run_phase_b_batch.sh              # default RFMO set
#   RFMO_LIST="CCSBT,FFA" scripts/reconciliation/run_phase_b_batch.sh
#
# Honors env toggles passed in (or rely on defaults from diff_config.yaml):
#   CASE_INSENSITIVE_COLUMNS, IGNORE_DATE_FORMATS, ROUND_FLOATS, IGNORE_WHITESPACE, PREFER_EXT

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)

DEFAULT_LIST="CCSBT,FFA,IOTC,NAFO,PNA,SPRFMO,WCPFC"
IFS="," read -r -a RFMOS <<< "${RFMO_LIST:-$DEFAULT_LIST}"

echo "Running Phase B for: ${RFMOS[*]}"

# Dependency preflight for final summary regeneration
if ! python3 - <<'PY' >/dev/null 2>&1
import pandas, numpy  # noqa: F401
print('ok')
PY
then
  echo "(warn) python3 with pandas/numpy not available; final summary refresh may be skipped."
fi

# Ensure summary exists/fresh
SUMMARY="$ROOT_DIR/tests/reconciliation/diffs/_summary.csv"
if [[ -f "$SUMMARY" ]]; then
  echo "(info) Existing summary will be overwritten by the diff harness"
fi

set +e
for rfmo in "${RFMOS[@]}"; do
  rfmo_trimmed=$(echo "$rfmo" | xargs)
  [[ -z "$rfmo_trimmed" ]] && continue
  echo "\n== Processing $rfmo_trimmed =="
  ONLY="$rfmo_trimmed" "$SCRIPT_DIR/run_phase_b.sh"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "  !! Phase B run failed for $rfmo_trimmed (exit=$rc), continuing..."
  fi
  # Print the summary line for the RFMO if present
  if [[ -f "$SUMMARY" ]]; then
    head -n 1 "$SUMMARY"
    grep -i "${rfmo_trimmed,,}_vessels_cleaned.csv" "$SUMMARY" || true
  fi
done
set -e

# Final diff generation to refresh summary if earlier runs aborted prematurely
if python3 - <<'PY' >/dev/null 2>&1
import pandas, numpy  # noqa: F401
print('ok')
PY
then
  "$SCRIPT_DIR/phase_b_diff.py" || true
else
  echo "(warn) Skipping final summary refresh: install pandas and numpy (e.g., pip install pandas numpy)"
fi

echo "\nBatch Phase B complete. See $SUMMARY and tests/reconciliation/diffs/*."
