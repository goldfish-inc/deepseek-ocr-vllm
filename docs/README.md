# Oceanid Infrastructure Documentation

> K3s cluster infrastructure with Pulumi IaC and Flux CD GitOps

## Quick Navigation

### 🏗️ Architecture

- [System Overview](./architecture/overview.md) - High-level architecture
- [Current State](./architecture/current-state.md) - Current infrastructure status
- [Data Architecture](./architecture/data-architecture.md) - Data flow and storage
- [GitOps Pattern](./architecture/gitops.md) - Flux CD implementation
- [Infrastructure Details](./architecture/infrastructure.md) - Component breakdown
- [ML Agents](./architecture/agents.md) - ML agent architecture
- [Implementation Summary](./architecture/implementation-summary.md) - What's been built
- [Project Plan](./architecture/project-plan.md) - Roadmap and milestones

### 📚 Setup Guides

- [ESC Setup](./guides/setup/esc-setup.md) - Pulumi ESC configuration
- [GitHub Token Setup](./guides/setup/github-token-setup.md) - GitHub authentication
- [Secret Management](./guides/setup/secret-management.md) - Managing secrets
- [Pulumi Free Tier](./guides/setup/pulumi-free-tier.md) - Free tier limitations

### 🚀 Deployment Guides

- [V3 to V6 Migration](./guides/deployment/v3-to-v6-migration.md) - Migration guide
- [SME Deployment](./guides/deployment/sme-deployment.md) - Subject Matter Expert deployment
- [SME Readiness](./guides/deployment/sme-readiness.md) - Pre-deployment checklist

### ⚙️ Operations

- [Operations Overview](./operations/overview.md) - Operational procedures
- [ML Backend & Ingest](./operations/ml-backend-and-ingest.md) - Adapter, sink, and project auto‑provisioning
- [Image Versioning & Rollbacks](./operations/image-versioning.md) - SHA‑pinned images and rollback flow
- [Automated Updates](./operations/automated-updates.md) - Image update automation
- [Version Monitoring](./operations/version-monitoring.md) - Version tracking
- [Version Audit](./operations/version-audit.md) - Dependency audit
- [Audit Summary](./operations/audit-summary.md) - Security audit results
- [Status Summary](./operations/status-summary.md) - Current status
- [Issues Summary](./operations/issues-summary.md) - Known issues
- [Issues TODO](./operations/issues-todo.md) - Pending issues

### 🔧 Maintenance

- [Infrastructure Fixes](./architecture/infrastructure-fixes.md) - Common fixes
- [Infrastructure Quick Check](./architecture/infrastructure-quick-check.md) - Health checks
- [Current Infrastructure Status](./architecture/current-infrastructure-status.md) - Live status
- [Reset Checklist](./operations/reset-checklist.md) - Reset procedures
- [Script Retirement](./operations/script-retirement.md) - Script deprecation

### 🤖 ML/AI Documentation

- [ML Backend Connection](./ML_BACKEND_CONNECTION.md) - ML service integration
- [Pandas Knowledge Extraction](./PANDAS_KNOWLEDGE_EXTRACTION.md) - Data extraction
- [SME Workflow](./SME_WORKFLOW.md) - Expert workflow automation
- [API Access](./API_ACCESS.md) - API authentication

### 📝 Architecture Decision Records (ADRs)

*Coming soon - architectural decisions will be documented here*

## Key Components

### Infrastructure Stack

- **K3s Cluster**: 3-node Kubernetes cluster
- **Pulumi IaC**: TypeScript infrastructure as code
- **Flux CD**: GitOps continuous deployment
- **Pulumi ESC**: Secret management
- **Cloudflare Tunnel**: Secure ingress
- **cert-manager**: TLS certificate management

### Monitoring & Automation

- **Image Update Automation**: Automatic container updates
- **Version Monitoring**: Dependency tracking
- **Health Checks**: Cluster health monitoring

## Quick Commands

### Cluster Access

```bash
# Establish SSH tunnel (REQUIRED)
ssh -L 16443:localhost:6443 tethys -N &

# Set kubeconfig
export KUBECONFIG=~/.kube/k3s-config.yaml

# Verify connection
kubectl get nodes
```

### GitOps Operations

```bash
# Check Flux status
kubectl get gitrepository,helmrelease -n flux-system

# Force reconciliation
kubectl annotate gitrepository flux-system -n flux-system \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

### Monitoring

```bash
# Cluster health
kubectl get pods --all-namespaces

# Image policies
kubectl get imagepolicy -n flux-system

# Automation status
kubectl get imageupdateautomation -n flux-system
```

## Important Notes

⚠️ **CRITICAL**: Never run `pulumi up` manually! All infrastructure changes must go through GitHub Actions to maintain GitOps workflow.

## Need Help?

1. Check the [Operations Overview](./operations/overview.md)
2. Review [Known Issues](./operations/issues-summary.md)
3. See [Infrastructure Fixes](./architecture/infrastructure-fixes.md)
4. Create a GitHub issue with the `infrastructure` label

---

*Last updated: 2025-10-01*
