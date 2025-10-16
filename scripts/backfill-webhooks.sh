#!/usr/bin/env bash
# Backfill webhook triggers for 1,761 existing Label Studio tasks
# Usage: ./scripts/backfill-webhooks.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration
DB_HOST="${DB_HOST:-p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-labelfish}"
DB_USER="${DB_USER:-postgres}"
SINK_URL="${SINK_URL:-http://annotations-sink.apps.svc.cluster.local:8080/webhook}"
INGEST_URL="${INGEST_URL:-http://annotations-sink.apps.svc.cluster.local:8080/ingest}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}✓${NC} $*"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $*"; }
log_error() { echo -e "${RED}✗${NC} $*"; }

# Check prerequisites
command -v psql >/dev/null 2>&1 || { log_error "psql not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { log_error "jq not found"; exit 1; }
command -v kubectl >/dev/null 2>&1 || { log_error "kubectl not found"; exit 1; }

# Get database password from ESC
log_info "Fetching database credentials from Pulumi ESC..."
DB_PASSWORD=$(esc env get default/oceanid-cluster --show-secrets 2>/dev/null | jq -r '.pulumiConfig."oceanid-cluster:cleandataDbUrl"' | sed -n 's/.*postgres:\/\/postgres:\([^@]*\)@.*/\1/p')

if [ -z "$DB_PASSWORD" ]; then
    log_error "Failed to retrieve database password from ESC"
    exit 1
fi

export PGPASSWORD="$DB_PASSWORD"

# Count tasks to backfill
log_info "Counting tasks to backfill..."
TASK_COUNT=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM labelfish.task;" | tr -d ' ')
log_info "Found $TASK_COUNT tasks in Label Studio database"

# Get projects with tasks
log_info "Analyzing projects..."
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "
SELECT
    p.id,
    p.title,
    COUNT(t.id) as task_count,
    MAX(t.created_at) as latest_task
FROM labelfish.project p
LEFT JOIN labelfish.task t ON t.project_id = p.id
GROUP BY p.id, p.title
ORDER BY task_count DESC;
"

# Create backfill strategy
cat > "$PROJECT_ROOT/tmp/backfill-tasks.sql" <<'SQL'
-- Get all tasks that need webhook triggers
-- We'll export these and POST them to the sink
SELECT
    t.id as task_id,
    t.project_id,
    t.data,
    t.created_at,
    p.title as project_title
FROM labelfish.task t
JOIN labelfish.project p ON t.project_id = p.id
ORDER BY t.created_at ASC;
SQL

log_info "Exporting tasks to JSON..."
TASKS_JSON=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c "$(cat "$PROJECT_ROOT/tmp/backfill-tasks.sql")" | \
    jq -R -s 'split("\n") | map(select(length > 0) | split("|")) | map({task_id: .[0], project_id: .[1], data: .[2], created_at: .[3], project_title: .[4]})')

TASKS_FILE="$PROJECT_ROOT/tmp/backfill-tasks-$(date +%Y%m%d-%H%M%S).json"
echo "$TASKS_JSON" > "$TASKS_FILE"
log_info "Saved tasks to: $TASKS_FILE"

# Port-forward to sink service
log_info "Setting up port-forward to annotations-sink..."
kubectl port-forward -n apps svc/annotations-sink 18080:8080 &
PF_PID=$!
trap 'kill $PF_PID 2>/dev/null || true' EXIT
sleep 3

# Send tasks to ingest endpoint
log_info "Sending tasks to ingest endpoint (batches of 100)..."
BATCH_SIZE=100
TOTAL=$(echo "$TASKS_JSON" | jq '. | length')
BATCHES=$(( (TOTAL + BATCH_SIZE - 1) / BATCH_SIZE ))

SUCCESS=0
FAILED=0

for ((i=0; i<BATCHES; i++)); do
    START=$((i * BATCH_SIZE))
    BATCH=$(echo "$TASKS_JSON" | jq -c ".[$START:$START+$BATCH_SIZE]")

    # Create ingest payload
    PAYLOAD=$(jq -nc --argjson tasks "$BATCH" '{
        project_id: ($tasks[0].project_id | tonumber),
        tasks: $tasks,
        annotations: []
    }')

    # POST to ingest endpoint
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        http://localhost:18080/ingest)

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    if [ "$HTTP_CODE" = "200" ]; then
        ((SUCCESS+=BATCH_SIZE)) || true
        log_info "Batch $((i+1))/$BATCHES: $BATCH_SIZE tasks ✓"
    else
        ((FAILED+=BATCH_SIZE)) || true
        log_error "Batch $((i+1))/$BATCHES failed: HTTP $HTTP_CODE"
        echo "$BODY" | jq -C '.' 2>/dev/null || echo "$BODY"
    fi
done

# Summary
echo ""
log_info "Backfill complete!"
log_info "  Success: $SUCCESS tasks"
[ $FAILED -gt 0 ] && log_warn "  Failed: $FAILED tasks" || true

# Verify in database
log_info "Verifying backfill..."
psql -h "$DB_HOST" -U "$DB_USER" -d cleandata -c "
SELECT
    COUNT(*) as total_docs,
    COUNT(DISTINCT source_type) as sources,
    MAX(created_at) as latest
FROM stage.documents;
"

log_info "Done!"
