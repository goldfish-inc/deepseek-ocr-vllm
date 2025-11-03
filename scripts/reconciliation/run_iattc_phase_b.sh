#!/usr/bin/env bash
set -euo pipefail

# Run Phase B for IATTC only, then show diff summary.

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)

export ONLY=IATTC

"$SCRIPT_DIR/run_phase_b.sh"

SUMMARY_FILE="$ROOT_DIR/tests/reconciliation/diffs/_summary.csv"
if [[ -f "$SUMMARY_FILE" ]]; then
  echo "\n== IATTC Phase B summary =="
  # Header then the IATTC row, if present
  head -n 1 "$SUMMARY_FILE"
  grep -i "iattc_vessels_cleaned.csv" "$SUMMARY_FILE" || echo "(no IATTC row in summary)"
else
  echo "Summary file not found: $SUMMARY_FILE" >&2
fi
