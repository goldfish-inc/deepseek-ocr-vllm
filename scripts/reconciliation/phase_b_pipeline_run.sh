#!/usr/bin/env bash
set -euo pipefail

RAW_DIR=${RAW_DIR:-data/raw/vessels/RFMO/raw}
OUTPUT_DIR=${OUTPUT_DIR:-tests/reconciliation/current}
MINIO_CONTAINER=${MINIO_CONTAINER:-csv-worker-minio}
DB_CONTAINER=${DB_CONTAINER:-csv-worker-db}
WEBHOOK_URL=${WEBHOOK_URL:-http://localhost:8080/webhook}
MINIO_BUCKET=${MINIO_BUCKET:-test-bucket}
MINIO_PREFIX=${MINIO_PREFIX:-reconciliation}
POLL_INTERVAL=${POLL_INTERVAL:-2}
MAX_WAIT_BASE=${MAX_WAIT_BASE:-60}
# Optional filter to run a single RFMO by slug (e.g., ONLY=ICCAT)
ONLY=${ONLY:-}

mkdir -p "$OUTPUT_DIR"

declare -a files
while IFS= read -r -d '' file; do
  files+=("$file")
done < <(find "$RAW_DIR" -maxdepth 1 -type f \( -name '*.csv' -o -name '*.tsv' -o -name '*.xlsx' -o -name '*.xls' \) -print0 | sort -z)

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No RFMO files found under $RAW_DIR" >&2
  exit 1
fi

upload_file() {
  local src=$1
  local dest=$2
  docker exec "$MINIO_CONTAINER" mkdir -p "$(dirname "$dest")" >/dev/null 2>&1 || true
  docker cp "$src" "$MINIO_CONTAINER:$dest"
}

wait_for_document() {
  local file_name=$1
  local max_wait=$2
  local waited=0
  while [[ $waited -le $max_wait ]]; do
    doc_id=$(docker exec "$DB_CONTAINER" psql -U postgres -d oceanid_test -At -c "SELECT id FROM stage.documents WHERE file_name='${file_name}' ORDER BY id DESC LIMIT 1;")
    if [[ -n "$doc_id" ]]; then
      echo "$doc_id"
      return 0
    fi
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
  done
  echo "" # timeout
  return 1
}

count_extractions() {
  local document_id=$1
  docker exec "$DB_CONTAINER" psql -U postgres -d oceanid_test -At -c "SELECT COUNT(*) FROM stage.csv_extractions WHERE document_id=${document_id};" 2>/dev/null | tr -d '\r' | tr -d ' '
}

wait_for_extractions() {
  local document_id=$1
  local max_wait=$2
  local waited=0
  local last_count=-1
  local stable_polls=0
  local required_stable=${REQUIRED_STABLE_POLLS:-3}
  while [[ $waited -le $max_wait ]]; do
    local cnt
    cnt=$(count_extractions "$document_id" || echo 0)
    if [[ -z "$cnt" ]]; then cnt=0; fi
    if [[ "$cnt" -gt 0 ]]; then
      if [[ "$cnt" -eq "$last_count" ]]; then
        stable_polls=$((stable_polls + 1))
      else
        stable_polls=0
      fi
      last_count=$cnt
      if [[ $stable_polls -ge $required_stable ]]; then
        echo "$cnt"
        return 0
      fi
    fi
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
  done
  echo "0"
  return 1
}

export_extractions() {
  local document_id=$1
  local output_path=$2
  local tmp_log="/tmp/phase_b_export_${document_id}.log"
  local tmp_sql="/tmp/phase_b_export_${document_id}.sql"

  # Write SQL to temp file for debugging
  cat > "$tmp_sql" <<SQL
\COPY (SELECT document_id, row_index, column_name, raw_value, cleaned_value, confidence, needs_review, similarity, rule_chain FROM stage.csv_extractions WHERE document_id=${document_id} ORDER BY row_index, column_name) TO STDOUT WITH CSV HEADER
SQL

  echo "  -> SQL file: $tmp_sql ($(wc -l < "$tmp_sql") lines)"
  echo "  -> Output: $output_path"

  set +e
  cat "$tmp_sql" | docker exec -i "$DB_CONTAINER" psql -U postgres -d oceanid_test > "$output_path" 2> "$tmp_log"
  local exit_code=$?
  set -e

  echo "  -> psql exit code: $exit_code"
  echo "  -> Output file size: $(wc -l < "$output_path" 2>/dev/null || echo 0) lines"
  if [[ $exit_code -ne 0 ]]; then
    echo "  !! export failed for document_id=${document_id} (psql exit ${exit_code})"
    echo "  !! stderr (first 120 lines):"
    sed -n '1,120p' "$tmp_log" || true
    echo "  !! SQL command:"
    cat "$tmp_sql"
    return $exit_code
  fi
  local lines
  lines=$(wc -l < "$output_path" || echo 0)
  if [[ "$lines" -lt 2 ]]; then
    echo "  !! export appears empty for document_id=${document_id} (lines=$lines). See: $tmp_log"
    echo "  !! SQL command:"
    cat "$tmp_sql"
    return 1
  fi
}

for file_path in "${files[@]}"; do
  file_name=$(basename "$file_path")
  # Derive slug from filename prefix (e.g., ICCAT_vessels_*.csv -> ICCAT)
  slug=$(echo "$file_name" | cut -d'_' -f1 | tr '[:lower:]' '[:upper:]')
  if [[ -n "$ONLY" ]] && [[ "${slug}" != "${ONLY^^}" ]]; then
    echo "== Skipping $file_name (ONLY=$ONLY) =="
    continue
  fi
  echo "== Processing $file_name =="
  minio_key="/data/${MINIO_PREFIX}/$file_name"
  upload_file "$file_path" "$minio_key"

  file_url="http://minio:9000/${MINIO_BUCKET}/${MINIO_PREFIX}/$file_name"
  task_id=$(( $(date +%s%N) % 900000000 + 100000000 ))

  payload=$(cat <<JSON
{
  "action": "TASK_CREATED",
  "task": {
    "id": $task_id,
    "data": {
      "csv_url": "$file_url",
      "meta": {
        "source_type": "RFMO",
        "source_name": "$(basename "$file_name" | cut -d'_' -f1)",
        "org_id": "rfmo",
        "doc_type": "vessel_registry"
      }
    },
    "project": {"id": 1}
  }
}
JSON
)

  echo "  -> triggering webhook"
  curl -sS -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" -d "$payload" > /tmp/reconciliation_webhook.log

  size_kb=$(du -k "$file_path" | cut -f1)
  max_wait=$(( MAX_WAIT_BASE + size_kb / 50 ))
  echo "  -> waiting up to ${max_wait}s for processing"
  document_id=$(wait_for_document "$file_name" "$max_wait" || true)
  if [[ -z "$document_id" ]]; then
    echo "  !! timeout waiting for document for $file_name after ${max_wait}s" >&2
    continue
  fi
  echo "  -> document_id $document_id"

  echo "  -> waiting for extractions to stabilize"
  export_count=$(wait_for_extractions "$document_id" "$max_wait" || echo 0)
  if [[ -z "$export_count" || "$export_count" -eq 0 ]]; then
    echo "  !! timeout waiting for extractions for $file_name (document_id=$document_id)" >&2
    continue
  fi
  echo "  -> extractions ready: $export_count rows"

  # Disambiguate export filename by source extension to avoid overwrites (csv vs xlsx)
  ext="${file_name##*.}"
  ext_lc=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
  output_file="$OUTPUT_DIR/${file_name%.*}_${ext_lc}_stage.csv"
  export_extractions "$document_id" "$output_file"
  echo "  -> exported to $output_file"

done

echo "All files processed."
