#!/usr/bin/env bash
set -euo pipefail

: "${DB_URL:?DB_URL is required (e.g. postgres://postgres:postgres@localhost:5432/postgres)}"

PHASE=${1:-phase0}

echo "Waiting for database to be ready..."
for attempt in $(seq 1 30); do
  if psql "$DB_URL" -c 'select 1' >/dev/null 2>&1; then
    echo "Database is ready."
    break
  fi
  echo "Attempt $attempt/30: waiting for Postgres..." >&2
  sleep 1
done

if ! psql "$DB_URL" -c 'select 1' >/dev/null 2>&1; then
  echo "Database did not become ready in time" >&2
  exit 1
fi

TEST_DIR="sql/tests/${PHASE}"
if [ ! -d "$TEST_DIR" ]; then
  echo "No tests for phase: $PHASE (directory $TEST_DIR not found)." >&2
  exit 1
fi

echo "Running SQL tests in $TEST_DIR ..."
shopt -s nullglob
for f in $TEST_DIR/*.sql; do
  echo "==> test: $f"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done
echo "All tests passed for $PHASE."
