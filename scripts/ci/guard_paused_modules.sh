#!/usr/bin/env bash
set -euo pipefail

# Guard paused components from changes while focus is on DB stabilization.
# Fails if diffs include Label Studio schema or app changes.

BASE_REF=${GITHUB_BASE_REF:-main}
HEAD_REF=${GITHUB_SHA:-HEAD}

# In PR context, fetch base ref for comparison
if [ -n "${GITHUB_BASE_REF:-}" ]; then
  # Fetch base branch with sufficient depth for comparison
  git fetch --quiet --depth=100 origin "$GITHUB_BASE_REF" 2>/dev/null || true
  # Use two-dot diff for PR context (shows changes in HEAD that aren't in base)
  changed_files=$(git diff --name-only "origin/$BASE_REF..$HEAD_REF" 2>/dev/null || git diff --name-only "origin/$BASE_REF" "$HEAD_REF")
else
  changed_files=$(git diff --name-only "$BASE_REF" "$HEAD_REF")
fi

blocked_patterns=(
  "^sql/.*label[^/]*\\.sql$"
  "^sql/migrations/.*label.*\\.sql$"
  "^clusters/.*/label-studio/"
  "^apps/.*/label.*"
  "^docs/.*label.*"
)

violations=()
while IFS= read -r file; do
  for pat in "${blocked_patterns[@]}"; do
    if [[ $file =~ $pat ]]; then
      violations+=("$file")
    fi
  done
done <<< "$changed_files"

if ((${#violations[@]} > 0)); then
  echo "Blocked changes detected in paused components:" >&2
  printf ' - %s\n' "${violations[@]}" >&2
  echo "\nPlease defer Label Studio-related changes until Phase 4 (see FOCUS.md)." >&2
  exit 1
fi

echo "Guard check passed: no paused component changes detected."
