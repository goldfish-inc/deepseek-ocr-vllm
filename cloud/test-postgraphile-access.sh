#!/usr/bin/env bash
set -euo pipefail

# Test PostGraphile Cloudflare Access authentication
# Usage: ./test-postgraphile-access.sh <client-secret>

CLIENT_ID="7d9a2003d9c5fbd626a5f55e7eab1398.access"
CLIENT_SECRET="${1:-}"
GRAPHQL_ENDPOINT="https://graph.boathou.se/graphql"

if [ -z "$CLIENT_SECRET" ]; then
    echo "❌ Error: Client secret required"
    echo ""
    echo "Usage: $0 <client-secret>"
    echo ""
    echo "To retrieve the secret:"
    echo "  1. If stored in Pulumi ESC: pulumi config get cfAccessServiceTokenSecret"
    echo "  2. If stored in 1Password: op read 'op://...'"
    echo "  3. If not stored: Regenerate token in Cloudflare dashboard"
    exit 1
fi

echo "🔍 Testing PostGraphile API Access"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Without authentication (should fail)
echo "Test 1: Request WITHOUT CF-Access headers"
echo "Expected: HTTP 302 (redirect to Cloudflare Access)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "$GRAPHQL_ENDPOINT" \
    -H "Content-Type: application/json" \
    -d '{"query": "{ __typename }"}')

if [ "$HTTP_CODE" = "302" ]; then
    echo "✅ PASS: Blocked unauthenticated request (HTTP $HTTP_CODE)"
else
    echo "❌ FAIL: Expected HTTP 302, got HTTP $HTTP_CODE"
fi
echo ""

# Test 2: With authentication (should succeed)
echo "Test 2: Request WITH CF-Access headers"
echo "Expected: HTTP 200 with GraphQL response"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    "$GRAPHQL_ENDPOINT" \
    -H "CF-Access-Client-Id: $CLIENT_ID" \
    -H "CF-Access-Client-Secret: $CLIENT_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"query": "{ __typename }"}')

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ PASS: Authenticated request succeeded (HTTP $HTTP_CODE)"
    echo "Response:"
    echo "$BODY" | jq '.' || echo "$BODY"
else
    echo "❌ FAIL: Expected HTTP 200, got HTTP $HTTP_CODE"
    echo "Response:"
    echo "$BODY"
fi
echo ""

# Test 3: Invalid credentials (should fail)
echo "Test 3: Request with INVALID secret"
echo "Expected: HTTP 403 (Access Denied)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "$GRAPHQL_ENDPOINT" \
    -H "CF-Access-Client-Id: $CLIENT_ID" \
    -H "CF-Access-Client-Secret: invalid-secret-12345" \
    -H "Content-Type: application/json" \
    -d '{"query": "{ __typename }"}')

if [ "$HTTP_CODE" = "403" ]; then
    echo "✅ PASS: Rejected invalid credentials (HTTP $HTTP_CODE)"
else
    echo "❌ FAIL: Expected HTTP 403, got HTTP $HTTP_CODE"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Test suite complete"
