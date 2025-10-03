# Oceanid Infrastructure – Agent Instructions

This file contains specific instructions for AI assistants working with the Oceanid infrastructure and deployment workflows.

## CRITICAL: Do Not Apply Manually

Never run Pulumi applies by hand (`pulumi up`, `pulumi destroy`, etc.). All infrastructure changes must go through automated deployments:

- Cloud stack (`cloud/`): Deployed by GitHub Actions with OIDC.
- Cluster stack (`cluster/`): Deployed by Pulumi Deployments using a self‑hosted agent that has kubeconfig access. Do not attempt to run cluster applies from GitHub runners.

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

## Deployment Workflow (Authoritative)

Use a single push‑to‑deploy flow across both stacks:

1) Commit and push changes to `main`.
   - Cloud resources are applied by GitHub Actions (`cloud-infrastructure.yml`).
   - Cluster resources are applied by Pulumi Deployments via the self‑hosted agent (configured in Pulumi Cloud).

2) Monitor deployments:
   - Cloud: GitHub Actions UI.
   - Cluster: Pulumi Cloud → Deployments → Runs (agent pool: `oceanid-cluster`).

3) Verify with kubectl only if necessary (debugging). Do not apply via CLI.

Manual fallback is discouraged; if absolutely needed for break‑glass, coordinate with ops.

### Testing Changes:
```bash
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

1. **SSH Connection Lost**:
   - Re-establish tunnel: `ssh -L 16443:localhost:6443 tethys -N &`
   - Verify kubeconfig: `KUBECONFIG=~/.kube/k3s-config.yaml`

2. **Pulumi State Issues**:
   - Check ESC connectivity: `pulumi whoami`
   - Refresh state: `pulumi refresh`

3. **Flux Authentication**:
   - Verify GitHub token: `kubectl get secret github-token -n flux-system`
   - Check repo access: `kubectl get gitrepository flux-system -n flux-system`

4. **Image Updates Not Working**:
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
