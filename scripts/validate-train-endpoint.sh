#!/usr/bin/env bash
set -euo pipefail

# Validate the /train endpoint quickly without requiring a GitHub token.
#
# Usage:
#   ENDPOINT_URL=${ENDPOINT_URL:-http://localhost:9090} ./scripts/validate-train-endpoint.sh
#
# Notes:
# - For local run: in another shell, start the adapter with TRAIN_DRY_RUN=1
#     (cd apps/ls-triton-adapter && TRAIN_DRY_RUN=1 go run .)
#   then run this script.
# - For cluster: port-forward the service first
#     kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &
#     ENDPOINT_URL=http://localhost:9090 ./scripts/validate-train-endpoint.sh

ENDPOINT_URL=${ENDPOINT_URL:-http://localhost:9090}

echo "Validating /health..."
curl -fsS "${ENDPOINT_URL}/health" | jq . || true

echo "\nValidating /setup..."
curl -fsS "${ENDPOINT_URL}/setup" | jq . || true

echo "\nPosting sample payload to /train..."
PAYLOAD='{
  "project": 42,
  "annotations": [
    {
      "id": 1,
      "result": [
        {
          "from_name": "label",
          "to_name": "text",
          "type": "labels",
          "value": {"start": 0, "end": 6, "text": "OceanX", "labels": ["VESSEL"]}
        }
      ]
    }
  ],
  "data": {"text": "OceanX departed from Rotterdam on 2024-10-05."}
}'

HTTP_CODE=$(curl -s -o /tmp/train_resp.json -w '%{http_code}' \
  -X POST "${ENDPOINT_URL}/train" \
  -H 'Content-Type: application/json' \
  --data "$PAYLOAD")

echo "HTTP ${HTTP_CODE}"
cat /tmp/train_resp.json | jq . || cat /tmp/train_resp.json

if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "\nUnexpected status code. Check adapter logs."
  exit 1
fi

echo "\n/ train endpoint validation complete."
