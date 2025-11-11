# Oceanid Infrastructure – Agent Instructions

## CRITICAL RULES

### Never Hardcode Credentials
**ABSOLUTE RULE**: Use Pulumi ESC for ALL secrets. Never hardcode tokens, passwords, API keys.
**Flow**: 1Password → Pulumi ESC → K8s env vars → apps

### Never Skip Validation Checks
**FORBIDDEN**:
- `--no-verify` on commits
- Commenting out tests
- Disabling linters
- `|| true` to hide failures
- `2>/dev/null` to suppress errors

**REQUIRED**: Run checks → fix root cause → verify → ask if stuck

### Never Break Working Infrastructure
**VERIFY FIRST**: System working? Config actually broken? User approval?
**IF NO**: Stop and ask user.

**Incident 2025-10-13**: AI "completed" working Tailscale config → cluster at 33% capacity.
**LESSON**: Working infrastructure that "looks incomplete" is NOT broken.

**PROHIBITED without approval**:
- `hostNetwork: true` in DaemonSets
- Cluster-wide networking changes
- Deploy without rollback plan

## Infrastructure

### Deployment
**CRITICAL**: Never `pulumi up` manually. Deploy via GitHub Actions only.
- **Cloud**: OIDC to Pulumi/Cloudflare
- **Cluster**: kubeconfig from GitHub Secrets → `157.173.210.123:6443`
- **Local**: `pulumi config get/set` (read-only)

### Cluster
**K3s v1.33.4+k3s1**: 3 nodes
- **tethys** (srv712429): Control plane, 157.173.210.123
- **styx** (srv712695): Worker, DOWN
- **calypso**: GPU worker, LAN 192.168.2.110

**Access methods**:
1. SSH to tethys (primary): `sshpass -p "TaylorRules" ssh root@157.173.210.123 'kubectl ...'`
2. MCP server (kubectl/docker)
3. Direct SSH to calypso: `ssh neptune@192.168.2.110` (password: C0w5in$pace)

### Secrets (Pulumi ESC)
```bash
# Read
pulumi config get argillaAdminApiKey

# Set (encrypted)
pulumi config set --secret argillaAdminApiKey "value"
```

**Key secrets**: `argillaPostgresPassword`, `argillaAuthSecret`, `argillaAdminPassword`,
`argillaAdminApiKey`, `argillaRedisUrl`, `huggingFaceToken`, `postgresPassword`

### 1Password Vaults
**CRITICAL**: Use ONLY these vaults for secrets. Never search entire `op` inventory.

**Authorized vaults**:
- **Development**: UUID `ddqqn2cxmgi4xl4rris4mztwea`
- **Infrastructure**: UUID `umiwex27w4s2blyi5uplrhsjge`

**Access pattern**:
```bash
# Correct - specify vault by UUID
op read "op://ddqqn2cxmgi4xl4rris4mztwea/ItemName/credential"

# Wrong - generic search across all vaults
op item list | grep something
```

**Hugging Face token**:
- Setup via `hf auth login` (preferred)
- OR stored in Development vault: UUID `5zmjz55o2bnv7fq6tfgpvzi3je`

### Database
**Crunchy Bridge** (Ebisu): DB `cleandata`, user `postgres`
**ESC key**: `oceanid-cluster:cleandataDbUrl`
**Firewall**: `157.173.210.123/32` (Tethys egress)
Argilla’s workspace DB/Elasticsearch run inside the cluster (no external firewall rules).

### Git
**REQUIRED for push**: `GIT_SSH_COMMAND="ssh -i ~/.ssh/claude-code-gh" git push origin main`
(SSH agent disabled to avoid biometric prompts)

### Grafana Cloud
**ALWAYS use Grafana MCP server** for dashboards, alerts, datasources.
**Instance**: `https://lfgf.grafana.net`
**Credentials**: Pulumi ESC `grafanaApiToken`

**Datasources**: Prometheus (`grafanacloud-lfgf-prom`), Loki, Tempo, Pyroscope

## CI/CD

### Workflows
- **cloud-infrastructure.yml**: Cloud resources (DNS, DB)
- **cluster-selfhosted.yml**: K8s resources + pre-flight checks
- **build-images.yml**: Containers → ghcr.io
- **deploy-cluster.yml**: Update image tags

### Validation
- **Pre-flight**: `cluster/scripts/preflight-check.sh` (ownership conflicts)
- **Post-deploy**: `cluster/scripts/flux-health-check.sh` (Flux health)

## Common Issues

**Helm ownership conflicts**: Pre-flight auto-cleans stale resources

**Flux missing**: Extract manifest:
```bash
kubectl get secret -n flux-system -l owner=helm -l name~=gitops-flux \
  -o jsonpath='{.items[-1].data.release}' | base64 -d | base64 -d | gzip -d | \
  jq -r '.manifest' | kubectl apply -f -
```

**Namespace not found**: Force reconcile:
```bash
kubectl annotate gitrepository flux-system -n flux-system \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

## Emergency Procedures

**Cluster recovery**: `ssh srv712429 && sudo systemctl restart k3s`

**Pulumi state**:
```bash
pulumi import <type> <name> <id>
pulumi refresh --yes
```

**Flux recovery**:
```bash
flux bootstrap github --owner=goldfish-inc --repository=oceanid
kubectl annotate gitrepository flux-system -n flux-system reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

## Standards

- **PostgreSQL**: Always use postgresql17-client in Alpine Dockerfiles
- **Flux CD**: v2.6.4, GitOps from `clusters/tethys/`
- **GitHub Issues**: Create before implementing, reference in commits, close after verification
- **Emoji prefixes**: 🗄️ DB, 🧠 ML, ⚙️ Workers, 📊 Dashboards, 🔧 Infra, 🐛 Bugs, 📝 Docs

## Documentation
- **Incidents**: `TAILSCALE_DAEMONSET_INCIDENT_2025-10-13.md`
- **Ownership**: `docs/RESOURCE_OWNERSHIP.md`
- **Secrets**: `docs/SECRETS_MANAGEMENT.md`
- **Operations**: `docs/operations/overview.md`
