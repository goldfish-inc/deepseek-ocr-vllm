#!/bin/bash
set -euo pipefail

# Get auth token from Pulumi ESC
cd "$(dirname "$0")"
TOKEN=$(pulumi config get aigAuthToken)

echo "Testing Ollama Worker at ollama-api.boathou.se..."
echo ""

# Test 1: Models list endpoint
echo "=== Test 1: GET /api/tags (list models) ==="
curl -s https://ollama-api.boathou.se/api/tags \
  -H "cf-aig-authorization: Bearer ${TOKEN}" \
  | jq -r '.models[] | .name' | head -5
echo ""

# Test 2: Chat completion
echo "=== Test 2: POST /v1/chat/completions ==="
curl -s https://ollama-api.boathou.se/v1/chat/completions \
  -H "cf-aig-authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.3:70b",
    "messages": [{"role": "user", "content": "What is 2+2? Answer in one word."}],
    "stream": false
  }' | jq -r '.choices[0].message.content'
echo ""

# Test 3: Verify auth rejection
echo "=== Test 3: Verify auth rejection (should fail) ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://ollama-api.boathou.se/api/tags)
echo "Request without auth header: HTTP $HTTP_CODE (expected 401)"
echo ""

echo "✅ All tests complete!"
