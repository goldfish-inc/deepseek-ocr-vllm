#!/usr/bin/env bash
# Create a dedicated Cloudflare Tunnel for node-level connectivity (e.g. Calypso)
# and store the resulting credentials inside the Pulumi ESC environment.
#
# Requirements:
#   - esc CLI authenticated (`esc login`)
#   - Cloudflare API token with Tunnel permissions already in ESC
#   - jq + curl available locally
#
# Usage:
#   scripts/create-node-tunnel.sh \
#       --name oceanid-node \
#       --hostname boathou.se \
#       [--esc-env default/oceanid-cluster]
#
# The script will:
#   1. Read Cloudflare credentials (account ID + API token) from the ESC environment
#   2. Create a new Cloudflare tunnel via the REST API
#   3. Assemble the JSON credentials expected by cloudflared
#   4. Persist the new tunnel ID/hostname/token back into ESC
#   5. Write the credentials file to ./tmp/<tunnel-id>.json for inspection

set -euo pipefail

ESC_ENV="default/oceanid-cluster"
TUNNEL_NAME="oceanid-node"
NODE_BASE_DOMAIN="boathou.se"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --esc-env)
            ESC_ENV="$2"
            shift 2
            ;;
        --name)
            TUNNEL_NAME="$2"
            shift 2
            ;;
        --hostname)
            NODE_BASE_DOMAIN="$2"
            shift 2
            ;;
        --help|-h)
            sed -n '1,80p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

if ! command -v esc >/dev/null 2>&1; then
    echo "esc CLI not found. Install Pulumi ESC CLI first." >&2
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required." >&2
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required." >&2
    exit 1
fi

TMP_DIR="$(pwd)/tmp"
mkdir -p "$TMP_DIR"

echo "→ Fetching Cloudflare credentials from ESC environment $ESC_ENV"

# Get the account ID (non-secret, can be extracted normally)
CLOUDFLARE_ACCOUNT_ID=$(esc env get "$ESC_ENV" pulumiConfig.oceanid-cluster:cloudflare_account_id 2>/dev/null | sed -n '/```json/,/```/p' | sed '1d;$d' | tr -d '"' | tr -d ' ')

if [[ -z "$CLOUDFLARE_ACCOUNT_ID" || "$CLOUDFLARE_ACCOUNT_ID" == "null" ]]; then
    echo "Missing Cloudflare account ID in ESC. Checking alternative path..." >&2
    CLOUDFLARE_ACCOUNT_ID=$(esc env get "$ESC_ENV" cloudflare.account_id 2>/dev/null | sed -n '/```json/,/```/p' | sed '1d;$d' | tr -d '"' | tr -d ' ')
fi

if [[ -z "$CLOUDFLARE_ACCOUNT_ID" || "$CLOUDFLARE_ACCOUNT_ID" == "null" ]]; then
    echo "Failed to find Cloudflare account ID in ESC." >&2
    exit 1
fi

echo "→ Using Cloudflare Account ID: $CLOUDFLARE_ACCOUNT_ID"

API_URL="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel"

echo "→ Creating Cloudflare tunnel '$TUNNEL_NAME' via API"
CREATE_PAYLOAD=$(jq -n --arg name "$TUNNEL_NAME" '{name: $name, config_src: "cloudflare"}')

# First, we need to get the API token value
# Since ESC masks secrets, we'll use it in a subshell with proper environment
echo "→ Executing API call with ESC environment context"

# Create a temporary script that will run with the ESC environment
TEMP_SCRIPT=$(mktemp)
cat > "$TEMP_SCRIPT" << 'SCRIPT_END'
#!/bin/bash
set -euo pipefail

# The environment will have CLOUDFLARE_API_TOKEN set by ESC
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "Error: CLOUDFLARE_API_TOKEN not found in environment" >&2
    exit 1
fi

# Make the API call
curl -sS -X POST "$1" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$2"
SCRIPT_END

chmod +x "$TEMP_SCRIPT"

# Run the script with ESC environment
CREATE_RESPONSE=$(esc env run "$ESC_ENV" -- "$TEMP_SCRIPT" "$API_URL" "$CREATE_PAYLOAD")

# Clean up
rm -f "$TEMP_SCRIPT"

if [[ $(jq -r '.success' <<<"$CREATE_RESPONSE") != "true" ]]; then
    echo "Cloudflare API call failed:" >&2
    echo "$CREATE_RESPONSE" | jq >&2 || echo "$CREATE_RESPONSE" >&2
    exit 1
fi

TUNNEL_ID=$(jq -r '.result.id' <<<"$CREATE_RESPONSE")
TUNNEL_SECRET=$(jq -r '.result.tunnel_secret' <<<"$CREATE_RESPONSE")
ACCOUNT_TAG=$(jq -r '.result.account_id // .result.account_tag // "'"$CLOUDFLARE_ACCOUNT_ID"'"' <<<"$CREATE_RESPONSE")

if [[ -z "$TUNNEL_ID" || -z "$TUNNEL_SECRET" ]]; then
    echo "Tunnel creation response missing id or secret:" >&2
    echo "$CREATE_RESPONSE" | jq >&2
    exit 1
fi

CREDENTIALS_JSON=$(jq -n \
    --arg AccountTag "$ACCOUNT_TAG" \
    --arg TunnelSecret "$TUNNEL_SECRET" \
    --arg TunnelID "$TUNNEL_ID" \
    --arg TunnelName "$TUNNEL_NAME" \
    '{AccountTag: $AccountTag, TunnelSecret: $TunnelSecret, TunnelID: $TunnelID, TunnelName: $TunnelName}')

CREDENTIALS_FILE="$TMP_DIR/${TUNNEL_ID}.json"

echo "→ Writing tunnel credentials to $CREDENTIALS_FILE"
printf '%s\n' "$CREDENTIALS_JSON" > "$CREDENTIALS_FILE"

TUNNEL_TARGET="${TUNNEL_ID}.cfargotunnel.com"

echo "→ Persisting tunnel configuration into ESC"

# Set the configuration values using the correct paths
echo "  - Setting node tunnel ID: $TUNNEL_ID"
esc env set "$ESC_ENV" "pulumiConfig.oceanid-cluster:cloudflareNodeTunnelId" "$TUNNEL_ID" --plaintext

echo "  - Setting node tunnel hostname: $NODE_BASE_DOMAIN"
esc env set "$ESC_ENV" "pulumiConfig.oceanid-cluster:cloudflareNodeTunnelHostname" "$NODE_BASE_DOMAIN" --plaintext

echo "  - Setting node tunnel target: $TUNNEL_TARGET"
esc env set "$ESC_ENV" "pulumiConfig.oceanid-cluster:cloudflareNodeTunnelTarget" "$TUNNEL_TARGET" --plaintext

echo "  - Setting node tunnel token (secret)"
# Base64 encode the credentials JSON for storage
CREDENTIALS_BASE64=$(echo "$CREDENTIALS_JSON" | base64)
esc env set "$ESC_ENV" "pulumiConfig.oceanid-cluster:cloudflareNodeTunnelToken" "$CREDENTIALS_BASE64" --secret

cat <<SUMMARY

✅ Cloudflare node tunnel created successfully.
   • Tunnel ID: $TUNNEL_ID
   • Hostname base domain: $NODE_BASE_DOMAIN
   • Target: $TUNNEL_TARGET

The credentials JSON was written to $CREDENTIALS_FILE for auditing. Remove it once the Pulumi deployment succeeds.

Next steps:
  1. Run 'pulumi refresh' (optional) then 'pulumi up' in ./cluster.
  2. Verify the node-tunnels DaemonSet connects (kubectl -n node-tunnels logs ...).
SUMMARY
