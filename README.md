# Oceanid Infrastructure

Production-ready Kubernetes cluster infrastructure using Pulumi and ESC.

## Architecture

- **Platform**: k3s v1.33.4 (lightweight Kubernetes)
- **IaC**: 100% Pulumi with ESC (no Terraform/Vault)
- **Networking**: Cloudflare Tunnels with QUIC optimization
- **Secrets**: Pulumi ESC with automatic rotation
- **TLS**: cert-manager v1.16.2 with Let's Encrypt

## Nodes

| Name | Role | Provider | IP | Status |
|------|------|----------|----|----|
| tethys | control-plane | Hostinger VPS | 157.173.210.123 | ✅ Active |
| styx | worker | Hostinger VPS | 191.101.1.3 | ✅ Active |
| meliae | worker | Oracle Cloud | 140.238.138.35 | ⏳ Pending |
| calypso | worker | Local | 192.168.2.68 | ⏳ Pending |

## Quick Start

```bash
# Set up environment
export KUBECONFIG=$PWD/cluster/kubeconfig.yaml

# Check cluster status
kubectl get nodes

# Deploy infrastructure
cd cluster
pulumi up --yes

# Access services
curl https://health.goldfish.io
```

## Project Structure

```
oceanid/
├── cluster/           # Kubernetes cluster configuration
│   ├── index.ts       # Main Pulumi infrastructure
│   ├── cert-manager.ts # TLS automation
│   ├── secret-rotation.ts # Automatic rotation
│   └── kubeconfig.yaml # Cluster access
├── scripts/           # Utility scripts
└── docs/             # Documentation
```

## ESC Configuration

All secrets managed through Pulumi ESC:
```bash
# View configuration
esc env get default/oceanid-cluster

# Run with environment
esc run default/oceanid-cluster -- kubectl get pods
```

## Services

- **Cloudflare Tunnel**: `6ff4dfd7-2b77-4a4f-84d9-3241bea658dc`
- **DNS Domain**: `*.goldfish.io`
- **cert-manager**: Automatic TLS with 30-day renewal
- **Secret Rotation**: Daily at 2 AM UTC

## Management

- **Pulumi Stack**: `ryan-taylor/oceanid-cluster/prod`
- **ESC Environment**: `default/oceanid-cluster`
- **1Password**: Infrastructure vault record

## Security Features

- UDP buffers optimized for QUIC protocol
- Pod Security Standards (restricted)
- Network policies enabled
- RBAC configured
- Automatic secret rotation (30-day TTL)

---
*Infrastructure as Code with Pulumi + ESC*