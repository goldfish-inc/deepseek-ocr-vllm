#!/bin/bash
# Complete Infrastructure Inventory
# Discovers all servers across Oracle, DigitalOcean, local, and other providers

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Complete Infrastructure Inventory            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}"

# Check for required tools
echo -e "\n${CYAN}Checking required tools...${NC}"

# Install DigitalOcean CLI if needed
if ! command -v doctl &>/dev/null; then
    echo -e "${YELLOW}Installing DigitalOcean CLI...${NC}"
    brew install doctl
fi

# Check 1Password CLI
if ! command -v op &>/dev/null; then
    echo -e "${RED}1Password CLI not found. Installing...${NC}"
    brew install 1password-cli
fi

# Authenticate with 1Password
if ! op account get &>/dev/null; then
    echo -e "${YELLOW}Authenticating with 1Password...${NC}"
    eval $(op signin)
fi

# Create output directory
OUTPUT_DIR="infrastructure-inventory-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUTPUT_DIR"

# Main inventory file
INVENTORY_FILE="$OUTPUT_DIR/inventory.md"

# Initialize inventory
cat > "$INVENTORY_FILE" << HEADER
# Infrastructure Inventory

**Generated**: $(date)
**Organization**: Ryan Taylor Infrastructure

## Summary

HEADER

# Arrays to track servers
declare -a ALL_SERVERS=()
declare -a REACHABLE_SERVERS=()
declare -a UNREACHABLE_SERVERS=()

# Function to test SSH connection
test_ssh() {
    local host="$1"
    local port="${2:-22}"
    local user="${3:-root}"
    local timeout="${4:-5}"

    ssh -o ConnectTimeout="$timeout" \
        -o StrictHostKeyChecking=no \
        -o PasswordAuthentication=no \
        -o BatchMode=yes \
        -p "$port" \
        "$user@$host" "exit" &>/dev/null
}

# Function to get server info
get_server_info() {
    local host="$1"
    local port="${2:-22}"
    local user="${3:-root}"

    ssh -o ConnectTimeout=5 \
        -o StrictHostKeyChecking=no \
        -o PasswordAuthentication=no \
        -p "$port" \
        "$user@$host" \
        'echo "HOSTNAME=$(hostname)"
         echo "OS=$(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \")"
         echo "KERNEL=$(uname -r)"
         echo "CPU=$(nproc) cores"
         echo "MEMORY=$(free -h | grep Mem | awk "{print \$2}")"
         echo "DISK=$(df -h / | tail -1 | awk "{print \$2}")"
         echo "IP_PUBLIC=$(curl -s ifconfig.me 2>/dev/null || echo unknown)"
         echo "IP_PRIVATE=$(ip -4 addr show | grep inet | grep -v 127.0.0.1 | head -1 | awk "{print \$2}" | cut -d/ -f1)"
         echo "DOCKER=$(docker --version &>/dev/null && echo Yes || echo No)"
         echo "UPTIME=$(uptime -p)"' 2>/dev/null
}

# =====================================
# 1. LOCAL INFRASTRUCTURE
# =====================================

echo -e "\n${MAGENTA}═══ LOCAL INFRASTRUCTURE ═══${NC}\n"

cat >> "$INVENTORY_FILE" << LOCAL
## Local Infrastructure

### RTX4090 Server
LOCAL

# Check RTX4090
echo -e "${CYAN}Checking RTX4090 Server (192.168.2.248)...${NC}"
if test_ssh "192.168.2.248" "22" "rt"; then
    echo -e "${GREEN}✓ Connected${NC}"
    INFO=$(get_server_info "192.168.2.248" "22" "rt")

    echo -e "${YELLOW}Server Name for RTX4090 (e.g., rtx-gpu-01, ml-workstation):${NC}"
    read -r RTX_NAME
    RTX_NAME=${RTX_NAME:-rtx4090-server}

    echo -e "${YELLOW}Primary Purpose (e.g., ML Training, GPU Compute, Development):${NC}"
    read -r RTX_PURPOSE
    RTX_PURPOSE=${RTX_PURPOSE:-GPU Compute Server}

    cat >> "$INVENTORY_FILE" << RTX_INFO
- **Name**: $RTX_NAME
- **IP**: 192.168.2.248
- **Purpose**: $RTX_PURPOSE
- **Status**: ✅ Online
- **Access**: rt@192.168.2.248

#### System Info
\`\`\`
$INFO
\`\`\`

RTX_INFO

    REACHABLE_SERVERS+=("$RTX_NAME")
else
    echo -e "${RED}✗ Cannot connect${NC}"
    cat >> "$INVENTORY_FILE" << RTX_OFFLINE
- **Name**: RTX4090 Server
- **IP**: 192.168.2.248
- **Status**: ❌ Offline
- **Access**: rt@192.168.2.248

RTX_OFFLINE
    UNREACHABLE_SERVERS+=("RTX4090")
fi

ALL_SERVERS+=("RTX4090")

# =====================================
# 2. ORACLE CLOUD INFRASTRUCTURE
# =====================================

echo -e "\n${MAGENTA}═══ ORACLE CLOUD INFRASTRUCTURE ═══${NC}\n"

cat >> "$INVENTORY_FILE" << ORACLE
## Oracle Cloud Infrastructure

ORACLE

# Get Oracle items from 1Password
echo -e "${CYAN}Searching for Oracle Cloud instances...${NC}"

ORACLE_ITEMS=$(op item list --vault Development --format json | jq -r '.[] | select(.title | test("Oracle|OCI"; "i")) | .id' 2>/dev/null)

for item_id in $ORACLE_ITEMS; do
    ITEM_DETAILS=$(op item get "$item_id" --format json 2>/dev/null)
    ITEM_TITLE=$(echo "$ITEM_DETAILS" | jq -r '.title')

    echo -e "\n${CYAN}Found: $ITEM_TITLE${NC}"

    # Try to find connection details
    HOST=$(echo "$ITEM_DETAILS" | jq -r '.fields[] | select(.label | test("hostname|ip|server|host"; "i")) | .value' | head -1)
    USER=$(echo "$ITEM_DETAILS" | jq -r '.fields[] | select(.label | test("username|user"; "i")) | .value' | head -1)

    if [[ -n "$HOST" ]]; then
        echo "Host: $HOST"
        USER=${USER:-ubuntu}

        echo -e "${YELLOW}Try to connect to $HOST? (y/n):${NC}"
        read -r CONNECT

        if [[ "$CONNECT" == "y" ]]; then
            if test_ssh "$HOST" "22" "$USER"; then
                echo -e "${GREEN}✓ Connected${NC}"
                INFO=$(get_server_info "$HOST" "22" "$USER")

                echo -e "${YELLOW}Server Name (descriptive):${NC}"
                read -r SERVER_NAME

                echo -e "${YELLOW}Primary Purpose:${NC}"
                read -r PURPOSE

                cat >> "$INVENTORY_FILE" << OCI_SERVER
### $SERVER_NAME
- **Provider**: Oracle Cloud
- **Host**: $HOST
- **Purpose**: $PURPOSE
- **Status**: ✅ Online
- **Access**: $USER@$HOST
- **1Password**: $ITEM_TITLE

#### System Info
\`\`\`
$INFO
\`\`\`

OCI_SERVER
                REACHABLE_SERVERS+=("$SERVER_NAME")
            else
                echo -e "${RED}✗ Cannot connect${NC}"
                UNREACHABLE_SERVERS+=("$ITEM_TITLE")
            fi
            ALL_SERVERS+=("$ITEM_TITLE")
        fi
    fi
done

# =====================================
# 3. DIGITALOCEAN INFRASTRUCTURE
# =====================================

echo -e "\n${MAGENTA}═══ DIGITALOCEAN INFRASTRUCTURE ═══${NC}\n"

cat >> "$INVENTORY_FILE" << DIGITALOCEAN
## DigitalOcean Infrastructure

DIGITALOCEAN

# Get DigitalOcean API token
echo -e "${CYAN}Getting DigitalOcean API token...${NC}"

DO_TOKEN=""
for item_id in "rtofea5tvkx7rbttqg5ycwgxa4" "ey6zsgm4h2wzvk55keh6ck3mru" "iele3vbl52zbdf6ot33m62heai"; do
    TOKEN=$(op item get "$item_id" --fields token 2>/dev/null || \
            op item get "$item_id" --fields api_key 2>/dev/null || \
            op item get "$item_id" --fields credential 2>/dev/null || true)
    if [[ -n "$TOKEN" ]]; then
        DO_TOKEN="$TOKEN"
        echo -e "${GREEN}✓ Found DigitalOcean token${NC}"
        break
    fi
done

if [[ -n "$DO_TOKEN" ]]; then
    # Configure doctl
    doctl auth init -t "$DO_TOKEN" &>/dev/null

    # List droplets
    echo -e "${CYAN}Fetching DigitalOcean droplets...${NC}"

    DROPLETS=$(doctl compute droplet list --format ID,Name,PublicIPv4,Status,Region --no-header 2>/dev/null)

    if [[ -n "$DROPLETS" ]]; then
        while IFS=' ' read -r id name ip status region; do
            echo -e "\n${CYAN}Droplet: $name${NC}"
            echo "IP: $ip"
            echo "Status: $status"
            echo "Region: $region"

            if [[ "$status" == "active" ]]; then
                echo -e "${YELLOW}Try to connect? (y/n):${NC}"
                read -r CONNECT

                if [[ "$CONNECT" == "y" ]]; then
                    echo -e "${YELLOW}SSH user (default: root):${NC}"
                    read -r USER
                    USER=${USER:-root}

                    if test_ssh "$ip" "22" "$USER"; then
                        echo -e "${GREEN}✓ Connected${NC}"
                        INFO=$(get_server_info "$ip" "22" "$USER")

                        echo -e "${YELLOW}Server Name (or press Enter for '$name'):${NC}"
                        read -r SERVER_NAME
                        SERVER_NAME=${SERVER_NAME:-$name}

                        echo -e "${YELLOW}Primary Purpose:${NC}"
                        read -r PURPOSE

                        cat >> "$INVENTORY_FILE" << DO_SERVER
### $SERVER_NAME
- **Provider**: DigitalOcean
- **Droplet**: $name
- **IP**: $ip
- **Region**: $region
- **Purpose**: $PURPOSE
- **Status**: ✅ Online
- **Access**: $USER@$ip

#### System Info
\`\`\`
$INFO
\`\`\`

DO_SERVER
                        REACHABLE_SERVERS+=("$SERVER_NAME")
                    else
                        echo -e "${RED}✗ Cannot connect${NC}"
                        cat >> "$INVENTORY_FILE" << DO_OFFLINE
### $name
- **Provider**: DigitalOcean
- **IP**: $ip
- **Status**: ❌ Cannot connect
- **Region**: $region

DO_OFFLINE
                        UNREACHABLE_SERVERS+=("$name")
                    fi
                else
                    cat >> "$INVENTORY_FILE" << DO_SKIP
### $name
- **Provider**: DigitalOcean
- **IP**: $ip
- **Status**: ⚠️ Not checked
- **Region**: $region

DO_SKIP
                fi
                ALL_SERVERS+=("$name")
            fi
        done <<< "$DROPLETS"
    else
        echo -e "${YELLOW}No DigitalOcean droplets found${NC}"
    fi
else
    echo -e "${YELLOW}No DigitalOcean API token found${NC}"
fi

# =====================================
# 4. LABEL STUDIO VPS
# =====================================

echo -e "\n${MAGENTA}═══ LABEL STUDIO VPS ═══${NC}\n"

if op item get "Label Studio VPS" &>/dev/null; then
    echo -e "${CYAN}Checking Label Studio VPS...${NC}"
    LS_DETAILS=$(op item get "Label Studio VPS" --format json 2>/dev/null)
    LS_HOST=$(echo "$LS_DETAILS" | jq -r '.fields[] | select(.label | test("hostname|ip|host"; "i")) | .value' | head -1)

    if [[ -n "$LS_HOST" ]]; then
        echo "Host: $LS_HOST"

        if test_ssh "$LS_HOST" "22" "ubuntu"; then
            echo -e "${GREEN}✓ Connected${NC}"
            INFO=$(get_server_info "$LS_HOST" "22" "ubuntu")

            cat >> "$INVENTORY_FILE" << LS_SERVER
## Label Studio Infrastructure

### Label Studio Production
- **Host**: $LS_HOST
- **Purpose**: ML Data Labeling Platform
- **Status**: ✅ Online
- **Access**: ubuntu@$LS_HOST

#### System Info
\`\`\`
$INFO
\`\`\`

LS_SERVER
            REACHABLE_SERVERS+=("Label Studio")
        else
            echo -e "${RED}✗ Cannot connect${NC}"
            UNREACHABLE_SERVERS+=("Label Studio")
        fi
        ALL_SERVERS+=("Label Studio")
    fi
fi

# =====================================
# 5. CREATE 1PASSWORD ENTRIES
# =====================================

echo -e "\n${MAGENTA}═══ UPDATING 1PASSWORD ═══${NC}\n"

echo -e "${YELLOW}Create/update 1Password entries for all servers? (y/n):${NC}"
read -r UPDATE_OP

if [[ "$UPDATE_OP" == "y" ]]; then
    for server in "${REACHABLE_SERVERS[@]}"; do
        echo -e "${CYAN}Creating 1Password entry for: $server${NC}"

        # Create standardized entry
        op item create \
            --category=Server \
            --title="Server: $server" \
            --vault="Development" \
            --tags="infrastructure,managed" \
            2>/dev/null || echo "Entry may already exist"
    done
fi

# =====================================
# 6. GENERATE SUMMARY
# =====================================

TOTAL=${#ALL_SERVERS[@]}
ONLINE=${#REACHABLE_SERVERS[@]}
OFFLINE=${#UNREACHABLE_SERVERS[@]}

cat >> "$INVENTORY_FILE" << SUMMARY

## Summary Statistics

- **Total Servers**: $TOTAL
- **Online**: $ONLINE
- **Offline/Unreachable**: $OFFLINE

### Online Servers
$(printf '%s\n' "${REACHABLE_SERVERS[@]}" | sed 's/^/- /')

### Offline/Unreachable Servers
$(printf '%s\n' "${UNREACHABLE_SERVERS[@]}" | sed 's/^/- /')

## Next Steps

1. Set up HashiCorp Vault on one of the Oracle VPS instances
2. Configure Terraform to manage all infrastructure
3. Implement Boundary for secure access
4. Set up Consul for service discovery
5. Create Packer templates for consistent server images

SUMMARY

# =====================================
# 7. GENERATE TERRAFORM INVENTORY
# =====================================

echo -e "\n${MAGENTA}═══ GENERATING TERRAFORM CONFIG ═══${NC}\n"

cat > "$OUTPUT_DIR/terraform-inventory.tf" << 'TERRAFORM'
# Auto-generated Terraform inventory
# Generated: $(date)

variable "servers" {
  description = "All managed servers"
  type = map(object({
    provider = string
    ip       = string
    user     = string
    purpose  = string
  }))

  default = {
TERRAFORM

# Add servers to Terraform config
for server in "${REACHABLE_SERVERS[@]}"; do
    cat >> "$OUTPUT_DIR/terraform-inventory.tf" << TF_SERVER
    "${server// /_}" = {
      provider = "unknown"
      ip       = "0.0.0.0"
      user     = "root"
      purpose  = "TBD"
    }
TF_SERVER
done

cat >> "$OUTPUT_DIR/terraform-inventory.tf" << 'TF_END'
  }
}
TF_END

# =====================================
# FINAL OUTPUT
# =====================================

echo -e "\n${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Infrastructure Inventory Complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}\n"

echo -e "${BLUE}Files created:${NC}"
echo -e "  • Inventory: $INVENTORY_FILE"
echo -e "  • Terraform: $OUTPUT_DIR/terraform-inventory.tf"

echo -e "\n${BLUE}Summary:${NC}"
echo -e "  • Total Servers: $TOTAL"
echo -e "  • Online: ${GREEN}$ONLINE${NC}"
echo -e "  • Offline: ${RED}$OFFLINE${NC}"

echo -e "\n${YELLOW}View inventory:${NC}"
echo -e "  cat $INVENTORY_FILE"

echo -e "\n${YELLOW}Next step:${NC}"
echo -e "  Set up HashiCorp Vault for centralized secret management"