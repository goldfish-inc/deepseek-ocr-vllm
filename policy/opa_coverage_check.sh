#!/usr/bin/env bash
set -euo pipefail

# Minimum overall coverage (0.0-1.0). Default 0.75 (75%).
MIN=${OPA_COVERAGE_MIN:-0.75}

cd "$(dirname "$0")"

if ! command -v opa >/dev/null 2>&1; then
  echo "opa is required on PATH" >&2
  exit 2
fi

# Produce JSON coverage for all rego in this dir.
# OPA prints coverage per file; we aggregate only non-test policy files.
JSON=$(opa test -c --format=json *.rego || true)
if [ -z "$JSON" ]; then
  echo "No coverage JSON produced; failing." >&2
  exit 1
fi

total=$(echo "$JSON" | jq '[.files | to_entries[] | select(.key | test("_test\\.rego$") | not) | .value.total] | add // 0')
covered=$(echo "$JSON" | jq '[.files | to_entries[] | select(.key | test("_test\\.rego$") | not) | .value.covered] | add // 0')

if [ "${total}" = "0" ]; then
  echo "No non-test statements found for coverage; failing." >&2
  exit 1
fi

ratio=$(python3 - <<PY
total=float(${total})
covered=float(${covered})
print(covered/total)
PY
)

echo "OPA coverage: covered=${covered} total=${total} ratio=${ratio}"

awk -v r="$ratio" -v m="$MIN" 'BEGIN{ if (r+0 < m+0) { exit 1 } }'

echo "Coverage OK (>= ${MIN})"
