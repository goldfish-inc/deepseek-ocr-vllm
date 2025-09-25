#!/bin/bash
# Organize and consolidate 1Password server entries

set -euo pipefail

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Organizing 1Password Server Entries          ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}"

# Authenticate with 1Password
if ! op account get &>/dev/null; then
    eval $(op signin)
fi

echo -e "\n${YELLOW}Creating consolidated server entries...${NC}\n"

# 1. Hostinger Consensas VPS (Label Studio)
echo -e "${BLUE}Creating: Hostinger VPS - Consensas (Label Studio)${NC}"

op item delete "Label Studio VPS" --vault Development 2>/dev/null || true
op item delete "goldfish-sme postgres" --vault Development 2>/dev/null || true
op item delete "Goldfish SME Label Studio Secret" --vault Development 2>/dev/null || true

op item create --category=Server \
    --title="Hostinger VPS - Consensas (Label Studio)" \
    --vault="Development" \
    --tags="vps,hostinger,production,label-studio" \
    "url[url]=ssh://root@157.173.210.123" \
    "hostname[text]=srv712429.hstgr.cloud" \
    "ip_address[text]=157.173.210.123" \
    "ipv6_address[text]=2a02:4780:2d:337c::1" \
    "username[text]=root" \
    "password[concealed]=L3ILgj#0T8cZQtaHmNAQ" \
    "ssh_command[text]=ssh root@157.173.210.123" \
    "location[text]=United States - Boston" \
    "os[text]=Ubuntu 24.04.3 LTS" \
    "plan[text]=KVM 4" \
    "cpu[text]=4 cores" \
    "memory[text]=16 GB" \
    "disk[text]=200 GB" \
    "expiration[text]=2027-02-01" \
    "purpose[text]=Label Studio ML Platform, 1Password Connect, PostgreSQL" \
    "services[text]=Label Studio, 1Password Connect, PostgreSQL, Docker" \
    "label_studio_url[url]=https://label.boathou.se" \
    "label_studio_api_token[concealed]=fee5fccf1a1127381cc86a9ee183fc764b4f5415" \
    "postgres_password[concealed]=4J!vY.dD@_EBUG-oGX!m8eH-wk" \
    "ssh_key[text]=ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKFR4MbtQ+MkWBYz6Ql5od5JauSXCkCzINJyXFSF9aGB" \
    "notesPlain[text]=Primary production VPS running Label Studio ML platform with 1Password Connect for secret management and PostgreSQL database. Auto-renewal enabled until 2027-02-01." \
    2>/dev/null && echo -e "${GREEN}✓ Created${NC}" || echo -e "${YELLOW}Already exists${NC}"

# 2. RTX 4090 Workstation (update with correct IP)
echo -e "\n${BLUE}Updating: RTX 4090 Workstation${NC}"

op item delete "RTX 4090 Workstation" --vault Development 2>/dev/null || true

op item create --category=Server \
    --title="RTX 4090 Workstation - Local" \
    --vault="Development" \
    --tags="local,gpu,rtx4090,ml,ai" \
    "url[url]=ssh://ryan@192.168.2.68" \
    "hostname[text]=rtx4090-workstation" \
    "ip_address[text]=192.168.2.68" \
    "username[text]=ryan" \
    "sudo_password[concealed]=pretty.moon.knight0" \
    "ssh_command[text]=ssh ryan@192.168.2.68" \
    "location[text]=Local Network" \
    "os[text]=Ubuntu (to be installed)" \
    "gpu[text]=NVIDIA RTX 4090" \
    "purpose[text]=GPU-accelerated ML/AI tasks, Docling OCR, model training" \
    "ssh_key_path[text]=~/.ssh/id_ed25519_rtx4090" \
    "ssh_public_key[text]=ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINzfz04ESoNAyFdv466m895Z+MWEYxVTvcahxvIm/mDx RTX 4090 Workstation" \
    "notesPlain[text]=Local workstation with NVIDIA RTX 4090 GPU for ML/AI workloads. Needs Ubuntu 24.04 installation via bootable USB." \
    2>/dev/null && echo -e "${GREEN}✓ Created${NC}" || echo -e "${YELLOW}Already exists${NC}"

# 3. Check for other Hostinger server
echo -e "\n${BLUE}Looking for other Hostinger servers...${NC}"

HOSTINGER_ITEMS=$(op item list --vault Development --format json | jq -r '.[] | select(.overview.title | test("Hostinger|srv"; "i")) | .id + " :: " + .overview.title' 2>/dev/null || echo "")

if [[ -n "$HOSTINGER_ITEMS" ]]; then
    echo -e "${YELLOW}Found Hostinger-related items:${NC}"
    echo "$HOSTINGER_ITEMS"

    echo -e "\n${YELLOW}Do you have another Hostinger VPS? (y/n):${NC}"
    read -r HAS_OTHER

    if [[ "$HAS_OTHER" == "y" ]]; then
        echo "Enter the server details:"
        read -p "Hostname: " OTHER_HOSTNAME
        read -p "IP Address: " OTHER_IP
        read -p "SSH Username: " OTHER_USER
        read -p "SSH Password: " OTHER_PASS
        read -p "Purpose/Name: " OTHER_PURPOSE

        op item create --category=Server \
            --title="Hostinger VPS - $OTHER_PURPOSE" \
            --vault="Development" \
            --tags="vps,hostinger" \
            "url[url]=ssh://$OTHER_USER@$OTHER_IP" \
            "hostname[text]=$OTHER_HOSTNAME" \
            "ip_address[text]=$OTHER_IP" \
            "username[text]=$OTHER_USER" \
            "password[concealed]=$OTHER_PASS" \
            "purpose[text]=$OTHER_PURPOSE" \
            2>/dev/null && echo -e "${GREEN}✓ Created second Hostinger VPS${NC}"
    fi
fi

# 4. Clean up old/duplicate items
echo -e "\n${BLUE}Cleaning up old entries...${NC}"

# List of items to potentially remove (old/duplicate)
OLD_ITEMS=(
    "Label Studio VPS"
    "goldfish-sme postgres"
    "Goldfish SME Label Studio Secret"
    "Label Studio Goldfish"
    "1Password Connect - SME VPS"
    "goldfish-dev Access Token: sme-vps"
)

for item in "${OLD_ITEMS[@]}"; do
    echo -e "${YELLOW}Delete '$item'? (y/n):${NC}"
    read -r DELETE
    if [[ "$DELETE" == "y" ]]; then
        op item delete "$item" --vault Development 2>/dev/null && \
            echo -e "${GREEN}✓ Deleted: $item${NC}" || \
            echo -e "${YELLOW}Already deleted or not found${NC}"
    fi
done

# 5. Generate summary
echo -e "\n${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ 1Password Organization Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}\n"

echo -e "${BLUE}Consolidated Server Entries:${NC}"
echo "1. Hostinger VPS - Consensas (Label Studio)"
echo "   - IP: 157.173.210.123"
echo "   - Services: Label Studio, 1Password Connect, PostgreSQL"
echo ""
echo "2. RTX 4090 Workstation - Local"
echo "   - IP: 192.168.2.68"
echo "   - Purpose: GPU ML/AI workloads"
echo ""

# Create infrastructure summary
cat > infrastructure-summary.md << 'EOF'
# Infrastructure Summary

## Active Servers

### 1. Hostinger VPS - Consensas (Label Studio)
- **Provider**: Hostinger
- **Location**: Boston, US
- **IP**: 157.173.210.123
- **Hostname**: srv712429.hstgr.cloud
- **OS**: Ubuntu 24.04.3 LTS
- **Resources**: 4 CPU, 16GB RAM, 200GB Disk
- **Services Running**:
  - Label Studio (https://label.boathou.se)
  - 1Password Connect
  - PostgreSQL (goldfish-postgres)
  - Docker
- **Expiration**: 2027-02-01 (auto-renewal enabled)
- **SSH**: `ssh root@157.173.210.123`

### 2. RTX 4090 Workstation (Local)
- **Location**: Local Network
- **IP**: 192.168.2.68
- **GPU**: NVIDIA RTX 4090
- **Purpose**: ML/AI GPU workloads
- **Status**: Needs Ubuntu 24.04 installation
- **SSH**: `ssh ryan@192.168.2.68`

## Next Steps

1. **Set up HashiCorp Vault** on Hostinger VPS (has resources available)
2. **Install Ubuntu 24.04** on RTX 4090 workstation
3. **Migrate secrets** from 1Password to Vault
4. **Configure Terraform** for infrastructure management
5. **Set up monitoring** with Prometheus/Grafana

## Cost Analysis

- **Hostinger VPS**: Paid until 2027-02-01
- **RTX 4090**: Local (electricity only)
- **Total Monthly**: ~$0 (already paid)
EOF

echo -e "\n${BLUE}Infrastructure summary saved to: infrastructure-summary.md${NC}"