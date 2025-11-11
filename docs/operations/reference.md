# Oceanid Operations Reference

## Troubleshooting

### 1. Pre-flight Blocks
Auto-cleans stale Helm resources, see `docs/RESOURCE_OWNERSHIP.md`

### 2. Flux Missing
Pulumi Helm bug, extract manifest manually:
```bash
kubectl get secret -n flux-system -l owner=helm -l name~=gitops-flux \
  -o jsonpath='{.items[-1].data.release}' | base64 -d | base64 -d | gzip -d | \
  jq -r '.manifest' | kubectl apply -f -
```

### 3. GitHub Actions Can't Connect
Update `KUBECONFIG` secret, verify endpoint `157.173.210.123:6443` accessible

### 4. Namespace Not Found
Flux timing issue, force reconcile:
```bash
kubectl annotate gitrepository flux-system -n flux-system \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

### 5. Worker Pods Can't Reach CrunchyBridge
Add node IP to firewall allowlist:
```bash
cb network add-firewall-rule --network ooer7tenangenjelkxbkgz6sdi \
  --rule <NODE_IP>/32 --description "<node> - K3s worker"
```

## Database Management

**Crunchy Bridge** (Ebisu): `p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com`
**DB**: `cleandata`, **User**: `postgres`
**ESC Key**: `oceanid-cluster:cleandataDbUrl`

**Firewall**: Unified allowlist via Tailscale exit node
- `157.173.210.123/32` (srv712429 exit node)
- Remove legacy node IPs after verification

**Test Connection**:
```bash
kubectl -n apps run pgtest --rm -i --image=postgres:16-alpine \
  --env="DATABASE_URL=<url>" --command -- pg_isready -d "$DATABASE_URL"
```

## Emergency Procedures

### Cluster Recovery
```bash
ssh srv712429 && sudo systemctl restart k3s
```

### Pulumi State
```bash
pulumi import <type> <name> <id>
pulumi refresh --yes
```

### Flux Recovery
```bash
flux bootstrap github --owner=goldfish-inc --repository=oceanid
kubectl annotate gitrepository flux-system -n flux-system reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

## Documentation
- **Incidents**: `TAILSCALE_DAEMONSET_INCIDENT_2025-10-13.md`, `RECOVERY_PLAN_2025-10-13.md`
- **Cluster Access**: `docs/cloudflare-warp-setup.md`, `docs/warp-next-action.md`
- **Ownership**: `docs/RESOURCE_OWNERSHIP.md`
- **Secrets**: `docs/SECRETS_MANAGEMENT.md`
- **Operations**: `docs/operations/overview.md`
