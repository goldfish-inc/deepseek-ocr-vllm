#!/bin/bash
#
# Export all Label Studio tasks to JSON file for synthetic data generation
#
# Usage:
#   ./export_label_studio_tasks.sh [output_file]
#
# Default output: label_studio_tasks.json

set -e

OUTPUT_FILE="${1:-label_studio_tasks.json}"

echo "📡 Exporting Label Studio tasks..."

# Set kubeconfig
export KUBECONFIG=~/.kube/k3s-tethys-public.yaml

# Method 1: Try Label Studio API (requires authentication)
echo "Attempting Label Studio API export..."
kubectl -n apps port-forward svc/label-studio-ls-app 8888:8080 > /dev/null 2>&1 &
PF_PID=$!
sleep 3

# Get API token from secret
API_TOKEN=$(kubectl -n apps get secret label-studio-secret -o jsonpath='{.data.token}' 2>/dev/null | base64 -d || echo "")

if [ -n "$API_TOKEN" ]; then
    curl -s -X GET "http://127.0.0.1:8888/api/projects/1/tasks?page_size=2000" \
        -H "Authorization: Token $API_TOKEN" \
        -H "Accept: application/json" > "$OUTPUT_FILE"

    kill $PF_PID 2>/dev/null || true

    # Verify export
    if jq -e '.[0].id' "$OUTPUT_FILE" > /dev/null 2>&1; then
        TASK_COUNT=$(jq '. | length' "$OUTPUT_FILE")
        echo "✅ Exported $TASK_COUNT tasks to $OUTPUT_FILE"
        exit 0
    fi
fi

kill $PF_PID 2>/dev/null || true

# Method 2: Direct database query via psql pod
echo "Attempting direct database query..."

# Get database URL from environment
DB_URL=$(kubectl -n apps get secret label-studio-secret -o jsonpath='{.data.DATABASE_URL}' 2>/dev/null | base64 -d || echo "")

if [ -z "$DB_URL" ]; then
    # Try getting from deployment env
    DB_URL=$(kubectl -n apps get deploy label-studio-ls-app -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="DATABASE_URL")].value}' 2>/dev/null || echo "")
fi

if [ -n "$DB_URL" ]; then
    # Parse database credentials
    DB_HOST=$(echo "$DB_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
    DB_PORT=$(echo "$DB_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
    DB_NAME=$(echo "$DB_URL" | sed -n 's/.*\/\([^?]*\).*/\1/p')
    DB_USER=$(echo "$DB_URL" | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
    DB_PASS=$(echo "$DB_URL" | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')

    # Create temporary psql pod
    kubectl run -n apps psql-temp --rm -i --restart=Never \
        --image=postgres:16-alpine \
        --env="PGPASSWORD=$DB_PASS" \
        --command -- psql \
        -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -t -c "SELECT json_agg(json_build_object('id', t.id, 'data', t.data)) FROM task AS t WHERE t.project_id = 1;" \
        > "$OUTPUT_FILE"

    # Verify export
    if jq -e '.[0].id' "$OUTPUT_FILE" > /dev/null 2>&1; then
        TASK_COUNT=$(jq '. | length' "$OUTPUT_FILE")
        echo "✅ Exported $TASK_COUNT tasks to $OUTPUT_FILE"
        exit 0
    fi
fi

# Method 3: Manual instructions
echo ""
echo "❌ Automatic export failed. Manual steps:"
echo ""
echo "1. Port-forward to Label Studio:"
echo "   kubectl -n apps port-forward svc/label-studio-ls-app 8888:8080"
echo ""
echo "2. Get API token:"
echo "   kubectl -n apps get secret label-studio-secret -o jsonpath='{.data.token}' | base64 -d"
echo ""
echo "3. Export tasks:"
echo "   curl -X GET 'http://127.0.0.1:8888/api/projects/1/tasks?page_size=2000' \\"
echo "     -H 'Authorization: Token YOUR_TOKEN' \\"
echo "     -H 'Accept: application/json' > $OUTPUT_FILE"
echo ""
exit 1
