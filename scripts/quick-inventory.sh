#!/usr/bin/env bash
# Quick Infrastructure Inventory
# Based on known servers

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Quick Server Inventory Check             ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}"

# Known servers to check
declare -A SERVERS
SERVERS["RTX4090"]="192.168.2.248:22:rt:RTX4090 GPU Server:Local"
SERVERS["LabelStudio"]="157.173.210.123:22:root:Label Studio ML Platform:VPS"

# Output file
OUTPUT="infrastructure-quick-check.md"

cat > "$OUTPUT" << 'HEADER'
# Infrastructure Quick Check

Generated: $(date)

## Servers Status

HEADER

echo -e "\n${CYAN}Checking known servers...${NC}\n"

for name in "${!SERVERS[@]}"; do
    IFS=':' read -r host port user purpose location <<< "${SERVERS[$name]}"

    echo -e "${BLUE}Checking $name ($host)...${NC}"

    # Test connection
    if timeout 5 ssh -o StrictHostKeyChecking=no -o PasswordAuthentication=no -o ConnectTimeout=3 \
        -p "$port" "$user@$host" "echo 'Connected'" &>/dev/null; then

        echo -e "${GREEN}✓ $name is ONLINE${NC}"

        # Get basic info
        INFO=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
            -p "$port" "$user@$host" \
            "hostname; uname -r; free -h | grep Mem | awk '{print \$2}'; df -h / | tail -1 | awk '{print \$2}'" 2>/dev/null || echo "Could not get info")

        cat >> "$OUTPUT" << SERVER_INFO

### $name
- **Status**: ✅ Online
- **Host**: $host
- **Access**: $user@$host:$port
- **Purpose**: $purpose
- **Location**: $location
- **Quick Info**: $INFO

SERVER_INFO

        echo -e "${YELLOW}What should we call this server? (current: $name)${NC}"
        read -r NEW_NAME
        NEW_NAME=${NEW_NAME:-$name}

        echo -e "${YELLOW}Primary purpose? (current: $purpose)${NC}"
        read -r NEW_PURPOSE
        NEW_PURPOSE=${NEW_PURPOSE:-$purpose}

        # Update in file
        sed -i "" "s/### $name/### $NEW_NAME/" "$OUTPUT"
        sed -i "" "s/Purpose: $purpose/Purpose: $NEW_PURPOSE/" "$OUTPUT"

    else
        echo -e "${RED}✗ $name is OFFLINE or unreachable${NC}"

        cat >> "$OUTPUT" << SERVER_OFFLINE

### $name
- **Status**: ❌ Offline/Unreachable
- **Host**: $host
- **Access**: $user@$host:$port
- **Purpose**: $purpose
- **Location**: $location

SERVER_OFFLINE
    fi

    echo ""
done

# Check for DigitalOcean droplets using API token if available
echo -e "${CYAN}Checking for DigitalOcean droplets...${NC}"

# Try to get DO token from 1Password
DO_TOKEN=$(op item get "ey6zsgm4h2wzvk55keh6ck3mru" --fields api_key 2>/dev/null || \
           op item get "ey6zsgm4h2wzvk55keh6ck3mru" --fields token 2>/dev/null || echo "")

if [[ -n "$DO_TOKEN" ]]; then
    echo -e "${GREEN}✓ Found DigitalOcean token${NC}"

    # Get droplets
    DROPLETS=$(curl -s -X GET "https://api.digitalocean.com/v2/droplets" \
        -H "Authorization: Bearer $DO_TOKEN" | jq -r '.droplets[] | "\(.name):\(.networks.v4[0].ip_address):\(.status)"' 2>/dev/null || echo "")

    if [[ -n "$DROPLETS" ]]; then
        cat >> "$OUTPUT" << 'DO_HEADER'

## DigitalOcean Droplets

DO_HEADER

        while IFS=':' read -r name ip status; do
            echo -e "${BLUE}Found DO Droplet: $name ($ip)${NC}"

            cat >> "$OUTPUT" << DO_DROPLET
### $name
- **Provider**: DigitalOcean
- **IP**: $ip
- **Status**: $status

DO_DROPLET
        done <<< "$DROPLETS"
    fi
else
    echo -e "${YELLOW}No DigitalOcean token found${NC}"
fi

echo -e "\n${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}Quick inventory complete!${NC}"
echo -e "${GREEN}Results saved to: $OUTPUT${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}\n"

cat "$OUTPUT"