# Resource Ownership Contract

This document defines which tool/system owns which Kubernetes resources to prevent conflicts and accidental deletion.

## Ownership Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Infrastructure (Pulumi)                        │
│ - Namespaces (base infrastructure)                      │
│ - CRDs (Custom Resource Definitions)                    │
│ - Cluster-wide RBAC (ClusterRoles, ClusterRoleBindings)│
│ - Core operators (Flux, PKO, cert-manager)             │
└─────────────────────────────────────────────────────────┘
              ↓ manages
┌─────────────────────────────────────────────────────────┐
│ Layer 2: GitOps (Flux)                                  │
│ - Application deployments                               │
│ - Application configurations                            │
│ - Application RBAC (Roles, RoleBindings)               │
│ - Secrets (synced from ESC or 1Password)               │
└─────────────────────────────────────────────────────────┘
              ↓ manages
┌─────────────────────────────────────────────────────────┐
│ Layer 3: Applications                                    │
│ - StatefulSets                                          │
│ - DaemonSets                                            │
│ - Services                                              │
│ - ConfigMaps (app-specific)                            │
└─────────────────────────────────────────────────────────┘
```

## Detailed Ownership Map

### Pulumi Owns (cluster/src/)

**Namespaces:**
- `flux-system` - GitOps control plane
- `pulumi-system` - Pulumi Kubernetes Operator
- `cert-manager` - TLS certificate management
- `cloudflared` - Cloudflare Tunnel ingress

**Core Controllers (via Helm):**
- Flux CD v2 (`flux-system` namespace)
  - source-controller
  - kustomize-controller
  - helm-controller
  - notification-controller
  - image-automation-controller
  - image-reflector-controller
- Pulumi Kubernetes Operator (`pulumi-system` namespace)
- cert-manager (`cert-manager` namespace)
- Cloudflare Tunnel daemon (`cloudflared` namespace)

Guardrail: Flux controllers MUST run only in `flux-system`. An OPA policy enforces this and will block any controller Deployments outside that namespace.

**Cluster-scoped Resources:**
- CRDs (all Custom Resource Definitions)
- ClusterRoles with `meta.helm.sh/release-name` annotation
- ClusterRoleBindings with `meta.helm.sh/release-name` annotation

**Secrets:**
- `flux-system/github-token` - GitHub authentication for Flux
- `pulumi-system/pulumi-api-secret` - Pulumi Cloud access token

### Flux Owns (clusters/tethys/)

**Application Namespaces:**
- `apps` - PostGraphile and Go services
- `node-tunnels` - Per-node Cloudflare tunnels

**Application Resources:**
- Deployments in `apps`, `triton`, `node-tunnels`
- Services in application namespaces
- ConfigMaps in application namespaces
- Secrets sourced from external systems (ESC, 1Password)
- HelmReleases (Flux Helm operator)
- ImagePolicies (Flux image automation)

**GitOps Resources:**
- GitRepository `flux-system/flux-system`
- Kustomization `flux-system/flux-system`
- ImageUpdateAutomation resources

### Guardrails (OPA)

- Flux controller Deployments (`source/kustomize/helm/notification/image-automation/image-reflector`) are denied outside `flux-system`.
- Ingress objects are denied; use Cloudflare Tunnels and Gateway where applicable.
- Service types NodePort/LoadBalancer are denied; prefer ClusterIP behind tunnels.

### Pre-flight Script (`cluster/scripts/preflight-check.sh`)

**What It Can Delete:**
- Cluster-scoped resources with **STALE** Flux Helm release annotations
  - Example: ClusterRole with `meta.helm.sh/release-name: gitops-flux-OLD_HASH`
- Namespace-scoped Flux resources with **STALE** release names
  - Only if release name differs from current active release

**What It MUST NOT Delete:**
- Resources matching the **current** Flux Helm release
- Resources without Helm annotations
- Resources managed by Flux GitOps
- Any resources in namespaces other than `flux-system`

**Detection Logic:**
```bash
# Find current active Flux release
CURRENT_RELEASE=$(kubectl get secret -n flux-system -l owner=helm \
  -o jsonpath='{.items[*].metadata.name}' | \
  grep '^sh.helm.release.v1.gitops-flux-' | sort -V | tail -1)

# Only delete if stale
if [[ "$RELEASE_NAME" == gitops-flux-* && "$RELEASE_NAME" != "$CURRENT_RELEASE" ]]; then
  kubectl delete "$resource"
fi
```

## Conflict Resolution

### Scenario 1: Pulumi vs Flux Overlap

**Problem:** Both Pulumi and Flux try to manage the same resource
**Example:** Pulumi operator ClusterRoleBinding

**Solution:**
1. Decide which tool is authoritative (usually Pulumi for cluster-scoped, Flux for apps)
2. Remove duplicate manifests from the non-authoritative source
3. Document the decision here

**Case Study:** Pulumi Operator RBAC
- **Owner:** Pulumi (via Helm chart in `cluster/src/components/pulumiOperator.ts`)
- **Removed:** `clusters/base/pulumi-system/operator.yaml` (duplicate)
- **Reason:** Pulumi Helm deploys PKO with correct RBAC, Flux duplicate caused `roleRef` immutability conflicts

### Scenario 2: Pre-flight Script Deletes Active Resources

**Problem:** Pre-flight script deletes resources that are still in use
**Symptom:** Flux controllers vanish after deployment, never recreated

**Solution:**
1. Pre-flight script must detect **current** active release
2. Only delete resources with **different** release names (stale)
3. Health check after deployment catches issues

**Case Study:** Flux Controller Deletion (2025-10-08)
- **Bug:** Script deleted ALL `gitops-flux-*` resources, including active release
- **Fix:** Detect current release, only delete stale ones
- **Safeguard:** Post-deployment health check fails if controllers missing

### Scenario 3: Helm Provider Doesn't Apply Manifest

**Problem:** Pulumi Helm provider creates release secret but skips resource creation
**Symptom:** `helm list` shows deployed, but `kubectl get deploy` shows nothing

**Current Workaround:**
1. Post-deployment health check detects missing controllers
2. Manual intervention: Extract manifest from Helm secret, apply with kubectl
3. Long-term: Consider migrating to `pulumi/command` or Flux HelmRelease

**Detection:**
```bash
# Check if Helm release exists
kubectl get secret -n flux-system -l owner=helm

# Check if controllers exist
kubectl get deployment -n flux-system source-controller
```

## Validation Tools

### Pre-flight Checks
- **Script:** `cluster/scripts/preflight-check.sh`
- **Runs:** Before every Pulumi deployment
- **Purpose:** Detect and clean stale Helm resources
- **Exits:** Non-zero if blocking issues found

### Health Checks
- **Script:** `cluster/scripts/flux-health-check.sh`
- **Runs:** After every Pulumi deployment
- **Purpose:** Verify Flux controllers are running
- **Checks:**
  - All 6 Flux controller deployments exist
  - All controller pods are Running
  - GitRepository is Ready
  - Kustomization is reconciling

### Manual Verification
```bash
# Check Pulumi-managed resources
pulumi stack output

# Check Flux-managed resources
kubectl get gitrepository,kustomization -n flux-system

# Check application resources
kubectl get deploy,svc -n apps

# Check resource ownership annotations
kubectl get clusterrole -o yaml | grep 'meta.helm.sh/release-name'
```

## Change Process

### Adding New Infrastructure Component (Pulumi)
1. Add to `cluster/src/components/`
2. Wire into `cluster/src/index.ts`
3. Update this document with ownership
4. Run pre-flight + deployment + health check

### Adding New Application (Flux)
1. Add manifests to `clusters/base/<component>/`
2. Reference in `clusters/tethys/kustomization.yaml`
3. Commit to git (Flux auto-deploys)
4. Verify with `kubectl get kustomization -n flux-system`

### Migrating Ownership (Pulumi ↔ Flux)
1. Document the change here first
2. Remove from old owner
3. Add to new owner
4. Test in one deployment cycle
5. Verify no conflicts

## Emergency Procedures

### Flux Controllers Missing
```bash
# 1. Check if Helm release exists
kubectl get secret -n flux-system -l owner=helm -l name~=gitops-flux

# 2. Extract and apply manifest
kubectl get secret <release-name> -n flux-system \
  -o jsonpath='{.data.release}' | base64 -d | base64 -d | gzip -d | \
  jq -r '.manifest' | kubectl apply -f -

# 3. Verify controllers running
cluster/scripts/flux-health-check.sh
```

### Stale Resources Blocking Deployment
```bash
# 1. Run pre-flight checks manually
cluster/scripts/preflight-check.sh

# 2. If automated cleanup fails, manual cleanup:
kubectl delete clusterrole <name> --ignore-not-found
kubectl delete clusterrolebinding <name> --ignore-not-found

# 3. Re-run deployment
```

### Ownership Conflict
```bash
# 1. Identify which tool owns the resource (check this doc)
# 2. Remove from non-authoritative source
# 3. Force reconciliation:

# If Pulumi owns:
pulumi refresh --yes

# If Flux owns:
kubectl annotate gitrepository flux-system -n flux-system \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

## References

- [Pulumi Kubernetes Provider Docs](https://www.pulumi.com/registry/packages/kubernetes/)
- [Flux CD GitOps Toolkit](https://fluxcd.io/flux/components/)
- [Helm Release Metadata](https://helm.sh/docs/topics/advanced/#storage-backends)
- [Kubernetes Immutable Fields](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/#updating-labels)
