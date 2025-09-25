#!/bin/bash
# Server Inventory Script - Discover and document all servers

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Server Infrastructure Inventory          ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}"

# Output file
INVENTORY_FILE="infrastructure-inventory.md"

# Initialize inventory
cat > "$INVENTORY_FILE" << 'EOF'
# Infrastructure Inventory

Generated: $(date)

## Servers

EOF

# Function to check server
check_server() {
    local name="$1"
    local host="$2"
    local port="${3:-22}"
    local user="${4:-root}"
    local ssh_key="${5:-}"

    echo -e "\n${CYAN}Checking: $name${NC}"
    echo -e "Host: $host"

    # Build SSH command
    SSH_CMD="ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no"
    if [[ -n "$ssh_key" ]]; then
        SSH_CMD="$SSH_CMD -i $ssh_key"
    fi
    SSH_CMD="$SSH_CMD -p $port $user@$host"

    # Try to connect and get info
    if $SSH_CMD "echo 'Connected'" &>/dev/null; then
        echo -e "${GREEN}✓ Connected${NC}"

        # Get system info
        HOSTNAME=$($SSH_CMD "hostname" 2>/dev/null || echo "unknown")
        OS=$($SSH_CMD "cat /etc/os-release | grep PRETTY_NAME | cut -d'=' -f2 | tr -d '\"'" 2>/dev/null || echo "unknown")
        KERNEL=$($SSH_CMD "uname -r" 2>/dev/null || echo "unknown")
        CPU=$($SSH_CMD "lscpu | grep 'Model name' | cut -d: -f2 | xargs" 2>/dev/null || echo "unknown")
        MEMORY=$($SSH_CMD "free -h | grep Mem | awk '{print \$2}'" 2>/dev/null || echo "unknown")
        DISK=$($SSH_CMD "df -h / | tail -1 | awk '{print \$2}'" 2>/dev/null || echo "unknown")
        UPTIME=$($SSH_CMD "uptime -p" 2>/dev/null || echo "unknown")
        IP=$($SSH_CMD "ip -4 addr show | grep inet | grep -v 127.0.0.1 | head -1 | awk '{print \$2}' | cut -d/ -f1" 2>/dev/null || echo "$host")

        # Check for specific services
        DOCKER=$($SSH_CMD "docker --version 2>/dev/null" && echo "Yes" || echo "No")

        echo -e "\n${YELLOW}What should we name this server?${NC}"
        echo "Current hostname: $HOSTNAME"
        echo "Suggested name (or press Enter to keep hostname): "
        read -r SERVER_NAME
        SERVER_NAME=${SERVER_NAME:-$HOSTNAME}

        echo -e "\n${YELLOW}What is this server's primary purpose?${NC}"
        echo "Examples: Vault Server, Label Studio, Development, Testing, Production API"
        read -r PURPOSE

        # Append to inventory
        cat >> "$INVENTORY_FILE" << SERVER_ENTRY

### $SERVER_NAME

- **Purpose**: $PURPOSE
- **Host**: $host
- **IP**: $IP
- **OS**: $OS
- **Kernel**: $KERNEL
- **CPU**: $CPU
- **Memory**: $MEMORY
- **Disk**: $DISK
- **Uptime**: $UPTIME
- **Docker**: $DOCKER
- **SSH**: $user@$host:$port
- **1Password Item**: $name

SERVER_ENTRY

        echo -e "${GREEN}✓ Added to inventory${NC}"

        # Create/Update 1Password item
        echo -e "\n${BLUE}Updating 1Password...${NC}"
        op item get "$SERVER_NAME" &>/dev/null || \
        op item create \
            --category=Server \
            --title="$SERVER_NAME" \
            --vault="Development" \
            "hostname[text]=$host" \
            "ip[text]=$IP" \
            "username[text]=$user" \
            "port[text]=$port" \
            "purpose[text]=$PURPOSE" \
            "os[text]=$OS" \
            "cpu[text]=$CPU" \
            "memory[text]=$MEMORY" &>/dev/null && echo -e "${GREEN}✓ 1Password updated${NC}"

    else
        echo -e "${RED}✗ Cannot connect${NC}"

        cat >> "$INVENTORY_FILE" << SERVER_ENTRY

### $name (Unreachable)

- **Host**: $host
- **Status**: Cannot connect
- **SSH**: $user@$host:$port

SERVER_ENTRY
    fi
}

# Local servers
echo -e "\n${BLUE}=== Local Servers ===${NC}"

# RTX4090 Server
check_server "RTX4090 Server" "192.168.2.248" "22" "rt" "$HOME/.ssh/rtx4090_ed25519"

# Oracle VPS servers
echo -e "\n${BLUE}=== Oracle Cloud VPS ===${NC}"

# Get Oracle servers from 1Password
echo -e "${YELLOW}Checking Oracle VPS instances from 1Password...${NC}"

# Label Studio VPS
if op item get "Label Studio VPS" &>/dev/null; then
    HOST=$(op item get "Label Studio VPS" --fields hostname 2>/dev/null || \
           op item get "Label Studio VPS" --fields ip 2>/dev/null || \
           op item get "Label Studio VPS" --fields url 2>/dev/null || echo "")

    if [[ -n "$HOST" ]]; then
        check_server "Label Studio VPS" "$HOST" "22" "ubuntu"
    fi
fi

# Other Oracle instances
for item_id in "gixzzebirnacxvhtsogrz6wh24" "m4t26barp3ezjl24tltbzxmlc4" "yjs77j4r2cwmlhylk47hnrf5eu"; do
    ITEM_NAME=$(op item get "$item_id" --fields title 2>/dev/null || echo "")
    if [[ -n "$ITEM_NAME" ]]; then
        HOST=$(op item get "$item_id" --fields hostname 2>/dev/null || \
               op item get "$item_id" --fields ip 2>/dev/null || echo "")

        if [[ -n "$HOST" ]]; then
            echo -e "\n${CYAN}Found: $ITEM_NAME${NC}"
            echo "Host found: $HOST"
            echo "Try to connect? (y/n): "
            read -r CONNECT
            if [[ "$CONNECT" == "y" ]]; then
                check_server "$ITEM_NAME" "$HOST" "22" "ubuntu"
            fi
        fi
    fi
done

# Summary
echo -e "\n${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}Inventory saved to: $INVENTORY_FILE${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"

# Display inventory
echo -e "\n${BLUE}Current Infrastructure:${NC}"
cat "$INVENTORY_FILE"