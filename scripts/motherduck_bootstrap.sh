#!/usr/bin/env bash
set -euo pipefail

# Bootstrap MotherDuck databases for OCR/Annotation
# Usage:
#   MOTHERDUCK_TOKEN=... ./scripts/motherduck_bootstrap.sh
# or
#   ./scripts/motherduck_bootstrap.sh <MOTHERDUCK_TOKEN>

TOK=${MOTHERDUCK_TOKEN:-${1:-}}
if [[ -z "${TOK}" ]]; then
  echo "Error: Set MOTHERDUCK_TOKEN env var or pass it as first arg" >&2
  exit 1
fi

if ! command -v duckdb >/dev/null 2>&1; then
  echo "Error: duckdb CLI is required. Install from https://duckdb.org/docs/installation/" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "🔗 Connecting to MotherDuck and creating schemas..."

# Create temporary SQL file for execution
TMPFILE=$(mktemp)
# shellcheck disable=SC2064
trap "rm -f $TMPFILE" EXIT

cat > "$TMPFILE" <<'SQL'
INSTALL md;
LOAD md;
SET motherduck_token='__TOKEN__';

-- Create/attach Raw OCR DB
CREATE DATABASE IF NOT EXISTS md_raw_ocr;
ATTACH 'md:md_raw_ocr' AS rawdb;
USE rawdb;
SQL

# Append raw_ocr.sql
cat sql/motherduck/raw_ocr.sql >> "$TMPFILE"
cat sql/motherduck/views_raw.sql >> "$TMPFILE"

cat >> "$TMPFILE" <<'SQL'

-- Create/attach Annotated DB
CREATE DATABASE IF NOT EXISTS md_annotated;
ATTACH 'md:md_annotated' AS anndb;
USE anndb;
SQL

# Append annotated schemas
cat sql/motherduck/annotated.sql >> "$TMPFILE"
cat sql/motherduck/views_annotated.sql >> "$TMPFILE"
cat sql/motherduck/argilla_ingest_log.sql >> "$TMPFILE"

cat >> "$TMPFILE" <<'SQL'

-- Summary
SELECT 'md_raw_ocr tables' AS ctx, COUNT(*) AS n
FROM information_schema.tables WHERE table_catalog='rawdb' AND table_schema='main';
SELECT 'md_annotated tables' AS ctx, COUNT(*) AS n
FROM information_schema.tables WHERE table_catalog='anndb' AND table_schema='main';
SQL

# Replace token placeholder
sed -i.bak "s|__TOKEN__|${TOK}|g" "$TMPFILE" && rm -f "$TMPFILE.bak"

# Execute
duckdb < "$TMPFILE"

echo "✅ MotherDuck bootstrap complete."
