#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

"$SCRIPT_DIR/phase_b_pipeline_run.sh"
"$SCRIPT_DIR/phase_b_diff.py"

echo "Phase B execution complete. Review tests/reconciliation/diffs for results."
