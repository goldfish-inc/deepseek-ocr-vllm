# Current Infrastructure Status

## Known Servers

### 1. RTX4090 GPU Server (Local)

- **IP**: 192.168.2.248
- **User**: rt
- **Status**: Currently offline/not configured
- **Purpose**: GPU compute, ML training
- **Next Steps**: Need to install Ubuntu 24.04 via bootable USB

### 2. Label Studio VPS

- **Domain**: label.boathou.se
- **IP**: 157.173.210.123
- **User**: root (uses SSH password)
- **Status**: Running (website accessible)
- **Purpose**: ML data labeling platform
- **API**: <https://label.boathou.se/api/>
- **Next Steps**: Need SSH password to connect and inventory

### 3. Oracle Cloud VPS Instances

- Multiple accounts found in 1Password:
  - Holland Bloorview Oracle
  - Oracle Personal (<ryan@ryantaylor.me>)
  - Oracle Cloud (Consensas)
  - Oracle Cloud Free account - Celeste
- **Status**: Need to identify which ones have active VPS instances
- **Next Steps**: Need connection details (IPs/hostnames)

### 4. DigitalOcean Droplets

- Found references to:
  - Digital Ocean Reporting Droplet
  - Other DigitalOcean accounts
- **Status**: Need API token to list droplets
- **Next Steps**: Get API token from 1Password and enumerate

## Proposed Infrastructure Architecture with HashiCorp Stack

```
┌─────────────────────────────────────────┐
│         HashiCorp Vault                  │
│    (Central Secret Management)           │
│    Deploy on: Oracle Free VPS            │
└─────────────────────────────────────────┘
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌─────────┐   ┌─────────┐    ┌─────────┐
│RTX4090  │   │Label    │    │Oracle   │
│Server   │   │Studio   │    │VPS      │
└─────────┘   └─────────┘    └─────────┘
```

## Action Items

1. **Immediate**:
   - [ ] Get SSH password for Label Studio VPS
   - [ ] Identify active Oracle VPS instances
   - [ ] Get DigitalOcean API token

2. **Infrastructure Setup**:
   - [ ] Install Ubuntu on RTX4090 server
   - [ ] Choose Oracle VPS for Vault deployment
   - [ ] Set up HashiCorp Vault for secrets
   - [ ] Configure Terraform for IaC
   - [ ] Implement Boundary for secure access

3. **Documentation**:
   - [ ] Create proper 1Password entries for each server
   - [ ] Document server purposes and configurations
   - [ ] Create network diagram
   - [ ] Set up monitoring dashboard

## Security Recommendations

1. **Replace password auth with SSH keys** on Label Studio VPS
2. **Set up Boundary** for zero-trust access (no direct SSH)
3. **Centralize secrets** in Vault instead of 1Password
4. **Enable audit logging** on all servers
5. **Configure automatic security updates**

## Cost Analysis

- **Oracle Cloud**: Free tier (4 OCPU, 24GB RAM)
- **DigitalOcean**: $X/month (need to check active droplets)
- **Local RTX4090**: Electricity costs only
- **Total**: Mostly within free tiers

## Next Steps

1. Complete server inventory with connection details
2. Choose primary Oracle VPS for Vault
3. Begin HashiCorp stack deployment
4. Migrate secrets from 1Password to Vault
5. Set up Terraform management for all infrastructure
