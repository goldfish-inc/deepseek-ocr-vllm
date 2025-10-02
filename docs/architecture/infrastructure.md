# Infrastructure Inventory

**Last Updated**: 2025-09-24

## Production Servers

### 1. Hostinger VPS 1 - Consensas (Label Studio)

- **Provider**: Hostinger
- **Location**: Boston, US
- **IP**: 157.173.210.123
- **IPv6**: 2a02:4780:2d:337c::1
- **Hostname**: srv712429.hstgr.cloud
- **OS**: Ubuntu 24.04.3 LTS
- **Resources**: 4 CPU cores, 16GB RAM, 200GB Disk (20% used)
- **Uptime**: 8 hours
- **Services Running**:
  - Label Studio ML Platform (<https://label.boathou.se>)
  - 1Password Connect (op-connect)
  - 1Password Sync (op-sync)
  - PostgreSQL (goldfish-postgres)
  - Docker
- **Plan**: KVM 4
- **Expiration**: 2027-02-01 (auto-renewal enabled)
- **SSH Access**: `ssh root@157.173.210.123`
- **Root Password**: L3ILgj#0T8cZQtaHmNAQ

### 2. Hostinger VPS 2 - Blog Server

- **Provider**: Hostinger
- **Location**: Unknown
- **IP**: 191.101.1.3
- **IPv6**: 2a02:4780:10:65b1::1
- **Hostname**: srv712695.hstgr.cloud
- **OS**: Ubuntu 24.04.2 LTS
- **Resources**: 4 CPU cores, 16GB RAM, 200GB Disk (11% used)
- **Uptime**: 50 days, 7 hours
- **Services Running**:
  - Ghost Blog (rtBlog-ghost)
  - Nginx (rtBlog-nginx)
  - MySQL (rtBlog-mysql)
  - Docker
- **SSH Access**: `ssh root@191.101.1.3`
- **Root Password**: xU/xDiBP3kposNqflMD0
- **SSH Key**: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKnjlzq5LFq8l5BeKmsk8mhXM3bUZx/jMno7WxiLV90O

### 3. RTX 4090 Workstation (Local)

- **Location**: Local Network
- **IP**: 192.168.2.68
- **Hardware**: NVIDIA RTX 4090 GPU
- **OS**: Ubuntu (needs installation)
- **Purpose**: GPU-accelerated ML/AI tasks, Docling OCR, model training
- **User**: ryan
- **Sudo Password**: pretty.moon.knight0
- **SSH Key**: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINzfz04ESoNAyFdv466m895Z+MWEYxVTvcahxvIm/mDx
- **Status**: Needs Ubuntu 24.04 installation via bootable USB

## Infrastructure Summary

### Active Production Services

1. **Label Studio** - ML data labeling platform (VPS 1)
2. **1Password Connect** - Secret management API (VPS 1)
3. **Ghost Blog** - Content management (VPS 2)
4. **PostgreSQL** - Database for Label Studio (VPS 1)

### Resource Utilization

- **VPS 1 (Label Studio)**: 20% disk usage, moderate memory usage
- **VPS 2 (Blog)**: 11% disk usage, light load (0.15 avg)
- **Total Resources**: 8 CPU cores, 32GB RAM, 400GB storage across VPS

### Costs

- **Hostinger VPS 1**: Paid until 2027-02-01
- **Hostinger VPS 2**: Check expiration in Hostinger panel
- **RTX 4090**: Local (electricity only)

## Proposed HashiCorp Stack Deployment

### Recommended Architecture

```
┌─────────────────────────────────────────┐
│   HashiCorp Vault (Secret Management)    │
│   Deploy on: VPS 2 (Blog Server)         │
│   Reason: Lower load, 50+ days uptime    │
└─────────────────────────────────────────┘
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌─────────┐   ┌─────────┐    ┌─────────┐
│VPS 1    │   │VPS 2    │    │RTX4090  │
│Label    │   │Blog +   │    │GPU      │
│Studio   │   │Vault    │    │Server   │
└─────────┘   └─────────┘    └─────────┘
```

### Why VPS 2 for Vault?

1. **Stability**: 50+ days uptime shows reliability
2. **Resources**: Only 11% disk used, light CPU load
3. **Separation**: Keep Vault separate from production Label Studio
4. **Blog is lightweight**: Ghost doesn't consume many resources

## Next Steps

1. **Immediate Actions**:
   - [x] Inventory all servers
   - [x] Document credentials and access
   - [ ] Set up proper SSH key authentication (remove password auth)
   - [ ] Install Ubuntu 24.04 on RTX 4090 workstation

2. **HashiCorp Stack Setup**:
   - [ ] Install Vault on VPS 2 (Blog Server)
   - [ ] Configure Vault auto-unseal
   - [ ] Migrate secrets from 1Password
   - [ ] Set up Terraform for infrastructure management
   - [ ] Configure Boundary for secure access

3. **Security Improvements**:
   - [ ] Disable root password login (use SSH keys only)
   - [ ] Set up fail2ban on all servers
   - [ ] Configure UFW firewall rules
   - [ ] Enable automatic security updates

4. **Monitoring**:
   - [ ] Set up Prometheus on VPS 2
   - [ ] Configure Grafana dashboards
   - [ ] Add alerting for critical services

## Access Commands

```bash
# VPS 1 - Label Studio
ssh root@157.173.210.123

# VPS 2 - Blog
ssh root@191.101.1.3

# RTX 4090 (when ready)
ssh ryan@192.168.2.68

# Check all servers
for ip in 157.173.210.123 191.101.1.3; do
  echo "=== $ip ==="
  ssh root@$ip "hostname; uptime"
done
```

## Backup Strategy

### Current Backups

- Unknown - need to check if backups are configured

### Recommended Backup Plan

1. **Database Backups**: Daily PostgreSQL and MySQL dumps
2. **File Backups**: Weekly full backups of Docker volumes
3. **Configuration**: Store all configs in Git
4. **Destination**: Consider S3 or another VPS for backup storage
