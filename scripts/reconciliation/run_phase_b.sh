#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

"$SCRIPT_DIR/phase_b_pipeline_run.sh"

# Use conda python for diff script
PYTHON_CMD=$(conda run -n base which python 2>/dev/null || which python3)
"$PYTHON_CMD" "$SCRIPT_DIR/phase_b_diff.py"

echo "Phase B execution complete. Review tests/reconciliation/diffs for results."
