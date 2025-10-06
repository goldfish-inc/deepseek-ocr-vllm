# Oceanid Infrastructure – Agent Instructions

This file contains specific instructions for AI assistants working with the Oceanid infrastructure and deployment workflows.

## CRITICAL: Do Not Apply Manually

Never run Pulumi applies by hand (`pulumi up`, `pulumi destroy`, etc.). All infrastructure changes must go through automated deployments:

- Cloud stack (`cloud/`): Deployed by GitHub Actions with OIDC.
- Cluster stack (`cluster/`): Deployed by a GitHub self‑hosted runner on a host with kubeconfig access (e.g., tethys). Do not run cluster applies from GitHub‑hosted runners.

Allowed local Pulumi commands (read/config only):
- `pulumi config set` – write config (committed to git when applicable)
- `pulumi config get` – read config
- `pulumi stack output` – read‑only outputs

## Critical Connection Setup (for debugging only)

### K3s Cluster Access

**IMPORTANT**: The cluster uses a custom kubeconfig that requires SSH tunneling.

#### Correct Connection Process:
```bash
# 1. Establish SSH tunnel to correct port (16443, NOT 6443)
ssh -L 16443:localhost:6443 tethys -N &

# 2. Use the correct kubeconfig
export KUBECONFIG=~/.kube/k3s-config.yaml

# 3. Test connection
kubectl get nodes
```

#### Common Connection Errors:
- ❌ Using port 6443 instead of 16443
- ❌ Using wrong kubeconfig file
- ❌ Not establishing SSH tunnel first
- ❌ Killing SSH tunnels without proper cleanup

#### Troubleshooting Commands:
```bash
# Kill existing tunnels
pkill -f "ssh.*443"
lsof -ti:16443 | xargs kill -9

# Re-establish tunnel
ssh -L 16443:localhost:6443 tethys -N &

# Verify connection
KUBECONFIG=~/.kube/k3s-config.yaml kubectl get nodes
```

## Infrastructure Architecture

### Core Components

1. **K3s Cluster**: Lightweight Kubernetes with 3 nodes
   - `srv712429`: Control plane + master
   - `srv712695`: Worker node
   - `calypso`: GPU worker node

2. **Pulumi Infrastructure as Code**: All resources managed via TypeScript
   - Stack: `oceanid-cluster`
   - Environment: `prod`
   - Components in `cluster/src/components/`

3. **Pulumi ESC (Environments, Secrets, and Configuration)**:
   - Centralized secret management
   - GitHub tokens, API keys stored securely
   - No secrets in code or git

4. **Flux CD v2.6.4**: GitOps continuous deployment
   - Helm chart management
   - Automated image updates
   - Source: `clusters/tethys/`

### Key Infrastructure Files

```
cluster/
├── src/components/
│   ├── fluxBootstrap.ts        # Flux CD setup + GitHub secrets
│   ├── pulumiOperator.ts       # PKO v2.2.0 deployment
│   ├── certManager.ts          # TLS certificate management
│   ├── cloudflaredTunnel.ts    # Secure ingress
│   └── imageAutomation.ts      # Automated version updates
├── clusters/tethys/
│   ├── infrastructure.yaml     # Image policy markers
│   └── apps.yaml              # Application deployments
└── Pulumi.prod.yaml           # Stack configuration
```

## Pulumi ESC Secret Management

### How Secrets Work:
1. **Storage**: 1Password → Pulumi ESC → Kubernetes Secrets
2. **Access**: `pulumi config get --secret <key>`
3. **Deployment**: Secrets injected at runtime, never stored in git

### Current Secrets:
- `github.token`: Fine-grained GitHub token for Flux automation
- Additional secrets managed via ESC environment

### Adding New Secrets:
```bash
# Store in 1Password first
op item create --category="API Credential" --title="Service Name" credential="secret_value"

# Add to Pulumi ESC
pulumi config set --secret service.token "op://vault/item/credential"

# Use in code
const token = cfg.getSecret("service.token");
```

## Automated Version Management

### Image Update Automation
- **Flux Image Automation**: Monitors container registries
- **Policies**: Semantic versioning rules for auto-updates
- **Workflow**: Detects → Updates → Commits → PRs

### Current Monitored Images:
- **cert-manager**: v1.18.2 (auto-update v1.16-v1.18)
- **cloudflared**: 2025.9.1 (latest)
- **pulumi-operator**: v2.2.0 (manual updates)
- **flux**: v2.6.4 (manual updates)

### Version Policies:
```yaml
# Non-breaking updates (patches + minor)
cert-manager: ">=1.16.0 <1.19.0"
cloudflared: ">=1.0.0"  # Track latest

# Manual review required for major versions
```

## CI/CD Workflows

### Active GitHub Actions Workflows

All deployments use GitHub Actions with automated checks and validations.

#### Infrastructure Deployments

**Cloud Infrastructure** (`cloud-infrastructure.yml`)
- **Trigger**: Push to `main` touching `cloud/` directory or workflow file
- **Runs on**: GitHub-hosted runner (`ubuntu-latest`)
- **Authentication**: OIDC to Pulumi Cloud + Cloudflare
- **Deploys**: DNS, Cloudflare Access, CrunchyBridge databases
- **Optimizations**: pnpm caching, concurrency control

**Cluster Infrastructure** (`cluster-selfhosted.yml`)
- **Trigger**: Push to `main` touching `cluster/` directory or workflow file, or `workflow_dispatch`
- **Runs on**: Self-hosted runner (tethys with kubeconfig access)
- **Authentication**: OIDC to Pulumi Cloud
- **Pre-flight checks**: Validates cluster state before deployment
  - Detects Flux Helm ownership conflicts
  - Identifies CRD annotation mismatches
  - Reports namespace resource conflicts
  - Warns about crashlooping pods
- **Deploys**: K3s cluster resources, Flux CD, applications
- **Script**: `cluster/scripts/preflight-check.sh` runs before `pulumi up`

**Database Migrations** (`database-migrations.yml`)
- **Trigger**: Push to `main` touching `sql/` directory, or `workflow_dispatch`
- **Runs on**: Self-hosted runner (requires database network access)
- **Authentication**: ESC-managed database credentials
- **Runs**: Flyway-style SQL migrations in version order
- **Safety**: Read-only validation before destructive changes

#### Application Deployments

**Build and Push Images** (`build-images.yml`)
- **Trigger**: Push to `main` touching adapter/sink code
- **Runs on**: GitHub-hosted runner
- **Outputs**: Container images to `ghcr.io/goldfish-inc/oceanid/`
- **Triggers**: `Update Image Tags` workflow on success

**Update Image Tags** (`deploy-cluster.yml`)
- **Trigger**: `Build and Push Images` completion, or `workflow_dispatch`
- **Updates**: Pulumi ESC with new immutable image tags
- **Note**: Cluster deployment handles actual k8s resource updates

**Train and Publish NER Model** (`train-ner.yml`)
- **Trigger**: Manual workflow dispatch
- **Runs on**: GitHub-hosted runner
- **Trains**: spaCy NER model for marine species extraction
- **Publishes**: Model artifacts to releases

#### Quality & Documentation

**Infrastructure Policy Enforcement** (`policy-enforcement.yml`)
- **Trigger**: Pull requests touching infrastructure code
- **Validates**: Pulumi policy packs, Terraform plans
- **Blocks**: PRs that violate security/compliance policies

**Pre-commit Checks** (`pre-commit.yml`)
- **Trigger**: Pull requests
- **Runs**: Linters, formatters, security scans
- **Checks**: YAML, shell scripts, markdown, GitHub Actions syntax

**Trigger Nautilus Doc Sync** (`trigger-nautilus-sync.yml`)
- **Trigger**: Push to `main` touching docs or markdown
- **Action**: Rebuilds documentation site at nautilus.boathou.se

### Deployment Workflow (Authoritative)

Use a single push‑to‑deploy flow:

1. **Commit and push** changes to `main`
   - Cloud resources: Applied by `cloud-infrastructure.yml` (GitHub-hosted)
   - Cluster resources: Applied by `cluster-selfhosted.yml` (self-hosted)
   - Database changes: Applied by `database-migrations.yml` (self-hosted)

2. **Monitor deployments**
   - GitHub Actions UI shows real-time progress
   - Self-hosted runner logs available on tethys

3. **Pre-flight validation** (cluster deployments only)
   - Automatic validation before `pulumi up`
   - Fails fast on ownership conflicts
   - Prevents wasted deployment cycles

4. **Verify** with kubectl only if necessary (debugging)
   - Do not apply via CLI

**Manual applies are prohibited.** If break-glass access is needed, coordinate with ops.

### Pre-flight Validation

Before every cluster deployment, `cluster/scripts/preflight-check.sh` validates:

**Ownership Conflicts** (blocking):
- Flux Helm resources with mismatched release metadata
- CRDs with incorrect ownership annotations
- Namespace resources blocking new installations

**Operational Warnings** (non-blocking):
- Crashlooping pods that may be fixed by deployment
- Cluster connectivity issues

**Running manually**:
```bash
KUBECONFIG=~/.kube/k3s-config.yaml cluster/scripts/preflight-check.sh
```

**Exit codes**:
- `0`: All checks passed, safe to deploy
- `1`: Blocking issues found, fix before deployment

### Testing Changes:
```bash
# Run pre-flight checks locally
KUBECONFIG=~/.kube/k3s-config.yaml cluster/scripts/preflight-check.sh

# Check Pulumi deployment
pulumi stack output

# Verify Flux sync
kubectl get gitrepository -n flux-system
kubectl get helmrelease -n flux-system

# Monitor automation
kubectl get imagepolicy -n flux-system
kubectl logs -n flux-system deployment/image-automation-controller
```

## Monitoring & Troubleshooting

### Health Checks:
```bash
# Cluster health
kubectl get nodes
kubectl get pods --all-namespaces

# Flux status
kubectl get gitrepository,helmrelease -n flux-system

# Automation status
kubectl get imageupdateautomation flux-system -n flux-system
```

### Common Issues:

1. **Deployment Blocked by Pre-flight Checks**:
   - **Helm ownership conflicts**: Delete stale resources manually
     ```bash
     kubectl delete clusterrole,clusterrolebinding <resource-name>
     ```
   - **CRD annotation mismatches**: Re-label or delete/recreate CRDs
   - **Namespace conflicts**: Clean up old Flux resources in `flux-system` namespace

2. **Self-Hosted Runner Offline**:
   - Check runner status: `ssh tethys "systemctl status actions.runner.*"`
   - Restart runner: Follow GitHub docs for runner management
   - Fallback: Cannot deploy cluster changes until runner is online

3. **SSH Connection Lost** (for local debugging):
   - Re-establish tunnel: `ssh -L 16443:localhost:6443 tethys -N &`
   - Verify kubeconfig: `KUBECONFIG=~/.kube/k3s-config.yaml`

4. **Pulumi State Issues**:
   - Check ESC connectivity: `pulumi whoami`
   - Refresh state: `pulumi refresh` (local debugging only)
   - State conflicts: Let GitHub Actions handle deployment

5. **Flux Authentication**:
   - Verify GitHub token: `kubectl get secret github-token -n flux-system`
   - Check repo access: `kubectl get gitrepository flux-system -n flux-system`

6. **Image Updates Not Working**:
   - Check policies: `kubectl get imagepolicy -n flux-system`
   - Verify markers: Check `clusters/tethys/infrastructure.yaml`
   - Force reconcile: Annotate ImageUpdateAutomation resource

## Security Considerations

### Access Control:
- **SSH**: Key-based authentication only
- **Kubernetes**: RBAC enforced
- **Secrets**: Never stored in git, always via ESC
- **GitHub**: Fine-grained tokens with minimal permissions

### Network Security:
- **Cloudflare Tunnel**: Secure ingress without exposed ports
- **Private Registry**: Container images from trusted sources
- **TLS**: All communications encrypted

### Operational Security:
- **Automated Updates**: Only non-breaking changes
- **Manual Review**: Major version changes require approval
- **Audit Trail**: All changes tracked in git history
- **Rollback**: GitOps enables easy reversion

## Emergency Procedures

### Cluster Recovery:
```bash
# SSH to control plane
ssh srv712429

# Check K3s status
sudo systemctl status k3s

# Restart if needed
sudo systemctl restart k3s
```

### Pulumi State Recovery:
```bash
# Import existing resources
pulumi import <type> <name> <id>

# Refresh state from actual infrastructure
pulumi refresh --yes
```

### Flux Recovery:
```bash
# Re-bootstrap Flux
flux bootstrap github --owner=goldfish-inc --repository=oceanid

# Force reconciliation
kubectl annotate gitrepository flux-system -n flux-system \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

## Project Management

### GitHub Issues for Feature Tracking

**IMPORTANT**: All features, bugs, and enhancements MUST be tracked via GitHub issues.

#### Creating Issues:
```bash
# Use gh CLI for consistent formatting
gh issue create --title "🔧 Feature title" --body "Description" --label "enhancement" --assignee "@me"

# Standard emoji prefixes:
# 🗄️ Database/storage
# 🧠 ML/AI features
# ⚙️ Workers/services
# 📊 Dashboards/reporting
# 🔧 Infrastructure
# 🐛 Bugs
# 📝 Documentation
```

#### Issue Workflow:
1. **Plan first**: Create issue before implementing
2. **Reference in commits**: Use `#issue-number` in commit messages
3. **Link PRs**: Use `Closes #issue-number` in PR descriptions
4. **Update status**: Comment progress, blockers, decisions
5. **Close when complete**: Only after verification/testing

#### Current Active Projects:
- **Staging DB Pipeline** (#46-#50): ML-powered CSV cleaning with human-in-loop
- **Infrastructure Validation** (#40): Cluster health monitoring
- **GitOps Pattern** (#23): Flux + PKO implementation

#### Issue Labels:
- `enhancement`: New features
- `bug`: Something broken
- `documentation`: Docs updates
- `question`: Needs clarification
- `help wanted`: External input needed

#### Finding Issues:
```bash
# List open issues
gh issue list --label enhancement

# View specific issue
gh issue view 46

# Search issues
gh issue list --search "staging database"
```

---

## Key Reminders for AI Assistants

1. **ALWAYS** establish SSH tunnel to port 16443 before kubectl commands
2. **ALWAYS** use `KUBECONFIG=~/.kube/k3s-config.yaml`
3. **NEVER** store secrets in git - use Pulumi ESC
4. **ALWAYS** test connections before running complex operations
5. **ALWAYS** use proper error handling for connection issues
6. **NEVER** assume standard kubeconfig paths work
7. **ALWAYS** verify tunnel is active before kubectl operations
8. **ALWAYS** create GitHub issues before starting implementation work
9. **ALWAYS** reference issue numbers in commits and PRs

This infrastructure follows Infrastructure as Code principles with GitOps deployment, automated dependency management, and comprehensive security controls.
