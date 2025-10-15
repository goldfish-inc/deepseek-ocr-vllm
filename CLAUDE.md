# Oceanid Infrastructure – Agent Instructions

## CRITICAL: NEVER BREAK WORKING INFRASTRUCTURE

### 1. Verification Before Changes

**MANDATORY checks before ANY infrastructure modification:**
- [ ] System currently working? (check health, not config)
- [ ] Configuration actually broken?
- [ ] User approval obtained?
- [ ] Rollback plan documented?
- [ ] Single-node testing first?
- [ ] Preserves cluster networking (kubelet ↔ API)?
- [ ] Preserves SSH access?

**IF ANY "NO": STOP AND ASK USER.**

**Incident 2025-10-13**: AI saw "incomplete" Tailscale config on working nodes, applied breaking changes without verification → cluster at 33% capacity, manual console reboots required. **LESSON**: Working infrastructure that "looks incomplete" is NOT broken. Verify first, ask second, change last.

### 2. Prohibited Without User Approval
- ❌ `hostNetwork: true` in DaemonSets (breaks cluster networking)
- ❌ Modify networking on all nodes simultaneously
- ❌ Change routing/iptables from Kubernetes
- ❌ "Complete" configs without verifying they're broken
- ❌ Deploy changes without rollback plan

### 3. Verify Functionality, Not Deployment

**Database/Storage Verification Checklist:**
- [ ] Check app logs for actual DB type used
- [ ] List tables in configured DB to confirm usage
- [ ] Check for local DB files (SQLite, etc.)
- [ ] Verify write persists in correct location
- [ ] Data survives pod restart

**Example failure**: Label Studio had `DATABASE_URL` set, deployment succeeded, but silently used SQLite instead of Postgres (requires `POSTGRE_*` vars). User lost hours of work on pod restart.

## Helm Ownership Conflicts

**Problem**: Pulumi `helm.sh/v3.Release` generates random suffixes. Changing suffixes causes "invalid ownership metadata" errors on cluster-scoped resources.

**Prevention**:
1. Pre-flight script (`cluster/scripts/preflight-check.sh`) auto-cleans stale resources before deployment
2. Use `helm.sh/v4.Chart` instead of `v3.Release`

**Manual cleanup** (if needed):
```bash
kubectl get crd -o json | jq '.items[] | select(.metadata.name | endswith(".tailscale.com")) | .metadata.name'
kubectl get clusterrole,clusterrolebinding -o json | jq '.items[] | select(.metadata.name == "tailscale-operator") | "\(.kind)/\(.metadata.name)"'
KUBECONFIG=~/.kube/k3s-warp.yaml cluster/scripts/preflight-check.sh
```

## Infrastructure Deployment

**CRITICAL**: Never run `pulumi up` manually. Deploy via GitHub Actions only.

- **Cloud stack**: GitHub-hosted runner, OIDC to Pulumi/Cloudflare
- **Cluster stack**: GitHub-hosted runner, kubeconfig from GitHub Secrets, connects to `157.173.210.123:6443`

**Local commands allowed**: `pulumi config get/set`, `pulumi stack output` (read-only)

## Authentication

### Hostinger VPS (Password Auth)
- **tethys** (srv712429): 157.173.210.123, Boston, `sshpass -p '<pwd>' ssh root@157.173.210.123`
- **styx** (srv712695): 191.101.1.3, Phoenix, `sshpass -p '<pwd>' ssh root@191.101.1.3`
- Tokens in 1Password + ESC as `hostingerTethysApiToken`/`hostingerStyxApiToken`

### Git (SSH Keys, No 1Password Agent)
```bash
# REQUIRED for all git push operations
GIT_SSH_COMMAND="ssh -i ~/.ssh/claude-code-gh" git push origin main
```
Plain `git push` fails - SSH agent disabled to avoid biometric prompts.

### 1Password CLI
**Used for**: Pulumi ESC secrets, database creds, API tokens
**NOT used for**: SSH, Git, GitHub CLI

## Cluster Access

### Primary: Cloudflare WARP (Recommended)
```bash
warp-cli status  # Must show "Connected"
export KUBECONFIG=~/.kube/k3s-warp.yaml
kubectl get nodes
```
- Routes `10.42.0.0/16`, `10.43.0.0/16`, `192.168.2.0/24` via Cloudflare
- K8s API at `https://10.43.0.1:443`, no SSH tunnels needed
- Org: `goldfishinc.cloudflareaccess.com`, Mode: Gateway with WARP

### Fallback: SSH Tunnel (Emergency Only)
```bash
ssh -L 16443:localhost:6443 tethys -N &
export KUBECONFIG=~/.kube/k3s-config.yaml
kubectl get nodes
```

## Architecture

**K3s Cluster** (v1.33.4+k3s1): 3 nodes
- **srv712429** (tethys): Control plane, 157.173.210.123, Tailscale 100.95.51.125
- **srv712695** (styx): Worker, 191.101.1.3, DOWN
- **calypso**: GPU worker, LAN 192.168.2.110, Tailscale 100.83.53.38

**Pulumi ESC**: Centralized secrets (GitHub tokens, DB creds)
**Crunchy Bridge**: Ebisu cluster, DB `labelfish`, user `u_ogfzdegyvvaj3g4iyuvlu5yxmi`
**Flux CD** v2.6.4: GitOps from `clusters/tethys/`

## CI/CD Workflows

**Deployment Flow**: Push to `main` → GitHub Actions deploys

### Infrastructure
- **cloud-infrastructure.yml**: Cloud resources (DNS, Access, DB)
- **cluster-selfhosted.yml**: K8s resources, pre-flight checks, connects to public endpoint
- **database-migrations.yml**: SQL migrations (self-hosted runner)

### Applications
- **build-images.yml**: Build containers → ghcr.io
- **deploy-cluster.yml**: Update image tags in ESC

### Validation
- **Pre-flight**: `cluster/scripts/preflight-check.sh` - detects ownership conflicts, crashes
- **Post-deploy**: `cluster/scripts/flux-health-check.sh` - validates Flux controllers

**GitHub-Hosted Runner Migration** (2025-10-14): Cluster deployments now on `ubuntu-latest` runners using kubeconfig from GitHub Secrets, no SSH dependency.

## Secrets Management

**Storage Flow**: 1Password → Pulumi ESC → K8s Secrets

**Current Secrets**:
- `github.token`: Flux automation
- SSH keys: Emergency K3s provisioning only
- `KUBECONFIG` (GitHub Secret): `base64 < ~/.kube/k3s-tethys-public.yaml | gh secret set KUBECONFIG`

**Adding Secrets**:
```bash
op item create --category="API Credential" --title="Name" credential="value"
pulumi config set --secret service.token "op://vault/item/credential"
```

## Monitoring & Troubleshooting

### Common Issues

**1. Pre-flight Blocks**: Auto-cleans stale Helm resources, see `docs/RESOURCE_OWNERSHIP.md`

**2. Flux Missing**: Pulumi Helm bug, extract manifest manually:
```bash
kubectl get secret -n flux-system -l owner=helm -l name~=gitops-flux \
  -o jsonpath='{.items[-1].data.release}' | base64 -d | base64 -d | gzip -d | \
  jq -r '.manifest' | kubectl apply -f -
```

**3. GitHub Actions Can't Connect**: Update `KUBECONFIG` secret, verify endpoint `157.173.210.123:6443` accessible

**4. Namespace Not Found**: Flux timing issue, force reconcile:
```bash
kubectl annotate gitrepository flux-system -n flux-system \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

**5. Worker Pods Can't Reach CrunchyBridge**: Add node IP to firewall allowlist:
```bash
cb network add-firewall-rule --network ooer7tenangenjelkxbkgz6sdi \
  --rule <NODE_IP>/32 --description "<node> - K3s worker"
```

## Database Management

**Crunchy Bridge** (Ebisu): `p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com`
**DB**: `labelfish`, **User**: `u_ogfzdegyvvaj3g4iyuvlu5yxmi`
**ESC Key**: `oceanid-cluster:labelStudioDbUrl`

**Firewall**: Unified allowlist via Tailscale exit node
- `157.173.210.123/32` (srv712429 exit node)
- Remove legacy node IPs after verification

**Test Connection**:
```bash
kubectl -n apps run pgtest --rm -i --image=postgres:16-alpine \
  --env="DATABASE_URL=<url>" --command -- pg_isready -d "$DATABASE_URL"
```

## Project Management

**GitHub Issues**: Create before implementing, reference in commits, close after verification

```bash
gh issue create --title "🔧 Feature" --body "Desc" --label "enhancement" --assignee "@me"
```

**Emoji Prefixes**: 🗄️ DB, 🧠 ML, ⚙️ Workers, 📊 Dashboards, 🔧 Infra, 🐛 Bugs, 📝 Docs

## Emergency Procedures

**Cluster Recovery**:
```bash
ssh srv712429 && sudo systemctl restart k3s
```

**Pulumi State**:
```bash
pulumi import <type> <name> <id>
pulumi refresh --yes
```

**Flux Recovery**:
```bash
flux bootstrap github --owner=goldfish-inc --repository=oceanid
kubectl annotate gitrepository flux-system -n flux-system reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

## Key Reminders for AI Assistants

### CRITICAL SAFETY RULES
1. ✅ VERIFY current state broken before changing
2. ✅ ASK user if unsure
3. ✅ TEST on one node first (networking changes)
4. ❌ NEVER `hostNetwork: true` for networking workloads
5. ❌ NEVER assume "incomplete config" = broken
6. ✅ HAVE rollback plan before risky changes
7. ✅ PRESERVE cluster networking (kubelet ↔ API)

### Standard Operating Procedures
- **Deploy**: GitHub Actions only (push to `main`)
- **kubectl**: Use WARP (`k3s-warp.yaml`), verify `warp-cli status`
- **Secrets**: Pulumi ESC, GitHub Secrets, 1Password (never git)
- **Workflow**: Create issues → reference in commits → verify → close
- **Validation**: Pre-flight checks, health checks, resource ownership

### Prohibited Patterns
- `hostNetwork: true` in DaemonSets (Incident 2025-10-13)
- Modify "incomplete-looking" configs without verification
- Cluster-wide networking without single-node test
- Route kubelet ↔ API through untested gateways
- Deploy without rollback plan

**When in doubt: ASK USER FIRST.**

## Documentation
- **Incidents**: `TAILSCALE_DAEMONSET_INCIDENT_2025-10-13.md`, `RECOVERY_PLAN_2025-10-13.md`
- **Cluster Access**: `docs/cloudflare-warp-setup.md`, `docs/warp-next-action.md`
- **Ownership**: `docs/RESOURCE_OWNERSHIP.md`
- **Secrets**: `docs/SECRETS_MANAGEMENT.md`
- **Operations**: `docs/operations/overview.md`
