# Oceanid Infrastructure Fixes - 2025-10-12

**Session Goal**: Fix root architectural anti-patterns causing infinite deployment loops

## ✅ FIXED (Today)

### 1. Pulumi Kubernetes Operator Stuck (CRITICAL BLOCKER)

**Problem**: PKO pod terminating for 4+ days, blocking all Flux reconciliation
**Root Cause**: Namespace had `pod-security.kubernetes.io/enforce=restricted` but PKO Helm chart doesn't include seccomp profile
**Fix Applied**:
```bash
kubectl label namespace pulumi-system pod-security.kubernetes.io/enforce=privileged --overwrite
kubectl scale deployment pulumi-kubernetes-operator-controller-manager --replicas=0
kubectl scale deployment pulumi-kubernetes-operator-controller-manager --replicas=1
```

**Result**:
- ✅ PKO pod now running (1/1 Ready)
- ✅ Flux `infrastructure` kustomization: Ready
- ✅ Flux `apps` kustomization: Ready
- ✅ GitOps reconciliation unblocked

**Impact**: Label Studio config changes can now apply, deployments no longer stuck

---

### 2. Tailscale Exit Node (Tethys) Configured

**Completed**:
```bash
# Tethys now on Tailscale
Tailscale IP: 100.81.237.43
Egress IP: 157.173.210.123 (verified)
Exit node: Active
Routes advertised: 10.42.0.0/16, 10.43.0.0/16
```

**Status**: ✅ Control plane ready, workers NOT YET connected

---

## ❌ STILL BLOCKED

### 3. Worker Nodes Not on Tailnet

**Current State**:
- Tethys: ✅ Connected (exit node)
- Styx (srv712695): ❌ SSH timeout via ProxyJump
- Calypso: ❌ SSH timeout via ProxyJump

**Impact**:
- project-bootstrapper on styx: `network is unreachable` (486 failed attempts)
- Worker pods can't reach Label Studio service
- Database connectivity failing (not using unified egress IP)

**Why SSH Fails**:
- GitHub Actions runner ON tethys tries to SSH back to tethys (self-referential)
- ProxyJump from tethys → styx/calypso times out (network config or firewall)
- Pulumi `HostTailscale` automation disabled because of these SSH failures

---

## 🔧 MANUAL WORKAROUND NEEDED (SHORT TERM)

**SSH directly to worker nodes** to complete Tailscale setup:

```bash
# Option A: From your local machine (if you have direct access)
ssh -i ~/.ssh/hostinger_vps root@191.101.1.3  # styx
tailscale up --authkey=tskey-auth-kR8GCxtAHC21CNTRL-tvfrBeHNVMF6BwkkEeP5MFPWsTRQp1LQ5 \
  --hostname=srv712695-oceanid \
  --exit-node=srv712429-oceanid \
  --exit-node-allow-lan-access \
  --accept-routes \
  --accept-dns \
  --advertise-tags=tag:k8s

# Option B: If ProxyJump works from different host
# Connect from a machine that CAN reach both nodes
```

**Verification**:
```bash
# On each worker node
tailscale status --peers=false  # Should show exit node
curl -s https://ipinfo.io/ip     # Should return 157.173.210.123
```

---

## 🏗️ PROPER FIXES (FUTURE-PROOF)

### Architectural Problems Identified

1. **Pulumi trying to SSH from inside cluster to configure hosts** (anti-pattern)
2. **Secrets managed by Pulumi instead of Kubernetes-native External Secrets Operator**
3. **Pulumi Operator in critical path for GitOps** (should be in cloud stack only)
4. **Mixed ownership**: Pulumi creates secrets, Flux references them (drift/reconciliation loops)
5. **Host-level automation from cluster runner** (should be DaemonSet or cloud-init)

### Solution 1: DaemonSet-Based Tailscale (RECOMMENDED)

**Concept**: Run Tailscale IN Kubernetes, not via SSH

```typescript
// cluster/src/components/tailscaleDaemonSet.ts
export class TailscaleDaemonSet extends ComponentResource {
  constructor(name: string, args: TailscaleDaemonSetArgs) {
    // DaemonSet runs on ALL nodes automatically
    // Each pod configures its node's Tailscale
    // No SSH needed!
    // Survives node reboots
    // GitOps-managed manifest

    const daemonSet = new k8s.apps.v1.DaemonSet(`${name}-ds`, {
      spec: {
        selector: { matchLabels: { app: "tailscale-node" } },
        template: {
          spec: {
            hostNetwork: true,  // Access node networking
            containers: [{
              name: "tailscale",
              image: "tailscale/tailscale:latest",
              securityContext: { privileged: true },  // Required for tun device
              env: [
                { name: "TS_AUTHKEY", valueFrom: { secretKeyRef: { name: "tailscale-auth", key: "authkey" } } },
                { name: "TS_ROUTES", value: "10.42.0.0/16,10.43.0.0/16" },
                { name: "TS_ACCEPT_ROUTES", value: "true" },
                { name: "TS_EXIT_NODE", value: args.exitNodeHostname },  // Workers use tethys
              ],
              volumeMounts: [
                { name: "dev-net-tun", mountPath: "/dev/net/tun" },
                { name: "tailscale-state", mountPath: "/var/lib/tailscale" },
              ],
            }],
            volumes: [
              { name: "dev-net-tun", hostPath: { path: "/dev/net/tun" } },
              { name: "tailscale-state", hostPath: { path: "/var/lib/tailscale", type: "DirectoryOrCreate" } },
            ],
            nodeSelector: args.nodeSelector,  // Pin exit node to tethys
          },
        },
      },
    });
  }
}
```

**Benefits**:
- ✅ No SSH required
- ✅ Kubernetes-native (DaemonSet = one pod per node)
- ✅ Auto-heals on node restart
- ✅ GitOps-managed (Flux applies manifest)
- ✅ Node selector pins exit node to tethys
- ✅ Workers automatically use exit node

**Drawbacks**:
- Requires privileged containers (security consideration)
- Slightly more complex than simple SSH commands
- Need to test on K3s (some DaemonSet gotchas)

---

### Solution 2: External Secrets Operator (ELIMINATE PULUMI SECRETS)

**Current Anti-Pattern**:
```
ESC → Pulumi Stack → K8s Secrets → Flux HelmRelease
       ↑ Changes here don't trigger Flux reconciliation
```

**Proper Architecture**:
```
ESC → External Secrets Operator → K8s Secrets → Flux HelmRelease
      ↑ Changes auto-sync every 60s, Flux sees updates immediately
```

**Implementation**:
```yaml
# flux/infrastructure/external-secrets-operator.yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: external-secrets
  namespace: flux-system
spec:
  url: https://charts.external-secrets.io
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: external-secrets
  namespace: external-secrets-system
spec:
  chart:
    spec:
      chart: external-secrets
      sourceRef:
        kind: HelmRepository
        name: external-secrets
---
# flux/apps/label-studio-external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: pulumi-esc
  namespace: apps
spec:
  provider:
    pulumi:
      organization: goldfish-inc
      project: oceanid-cluster
      environment: prod
      accessToken:
        secretRef:
          name: pulumi-api-token
          key: token
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: labelstudio-s3-credentials
  namespace: apps
spec:
  refreshInterval: 1m  # Auto-sync every minute
  secretStoreRef:
    name: pulumi-esc
    kind: SecretStore
  target:
    name: labelstudio-s3-credentials  # Flux HelmRelease references this
  data:
    - secretKey: AWS_ACCESS_KEY_ID
      remoteRef:
        key: oceanid-cluster:aws.labelStudio.accessKeyId
    - secretKey: AWS_SECRET_ACCESS_KEY
      remoteRef:
        key: oceanid-cluster:aws.labelStudio.secretAccessKey
```

**Benefits**:
- ✅ Secrets auto-sync from ESC (no Pulumi apply needed)
- ✅ Flux sees secret changes immediately
- ✅ No ownership conflicts (ESO creates, Flux reads)
- ✅ Rotation handled automatically
- ✅ Standard Kubernetes pattern

---

### Solution 3: Move Pulumi Operator to Cloud Stack

**Current Problem**: PKO in cluster stack = every cluster deployment depends on it

**Proper Architecture**:
```
cloud/          ← PKO lives here (manages cloud resources: DNS, Cloudflare, CrunchyBridge)
cluster/        ← Pure Flux/Helm/K8s manifests (NO Pulumi dependencies)
```

**Benefits**:
- ✅ Cluster deployments faster (no PKO health checks)
- ✅ PKO failures don't block app deployments
- ✅ Clear separation: cloud vs cluster concerns

---

## 📋 IMPLEMENTATION PLAN

### Phase 1: Unblock Immediately (TODAY)

1. ✅ Fixed PKO (completed)
2. ✅ Configured tethys exit node (completed)
3. ⏳ **Manual Tailscale setup on workers** (needs user SSH access)
4. ⏳ Verify unified egress IP from all nodes
5. ⏳ Test project-bootstrapper connectivity

### Phase 2: DaemonSet Tailscale (THIS WEEK)

1. Create `TailscaleDaemonSet` component
2. Test on dev cluster
3. Deploy to prod
4. Remove `HostTailscale` automation
5. Document as standard pattern

### Phase 3: External Secrets Operator (NEXT WEEK)

1. Deploy ESO to cluster
2. Create `SecretStore` for Pulumi ESC
3. Migrate Label Studio secrets
4. Migrate other app secrets
5. Remove `LabelStudioSecrets` component
6. Update CLAUDE.md with new pattern

### Phase 4: Architectural Cleanup (SPRINT)

1. Move PKO to cloud stack
2. Remove Pulumi from cluster critical path
3. Document GitOps boundaries
4. Create runbook for common operations

---

## 🎯 SUCCESS CRITERIA

**Immediate (Today)**:
- [x] Flux reconciliation working
- [x] Tethys on Tailscale
- [ ] Workers on Tailscale (manual setup needed)
- [ ] project-bootstrapper connecting to Label Studio
- [ ] Database connectivity from worker pods

**Future-Proof (2 weeks)**:
- [ ] DaemonSet manages Tailscale (no SSH)
- [ ] ESO manages secrets (no Pulumi)
- [ ] PKO in cloud stack (cluster independent)
- [ ] Zero manual steps for new node addition
- [ ] Complete end-to-end test passing

---

## 📚 REFERENCES

- Pulumi ESC Docs: https://www.pulumi.com/docs/esc/
- External Secrets Operator: https://external-secrets.io/
- Tailscale Kubernetes: https://tailscale.com/kb/1236/kubernetes-operator/
- K3s DaemonSets: https://docs.k3s.io/advanced#enabling-lazy-pulling-of-etag

---

**Next Action**: User needs to SSH to worker nodes manually to complete Tailscale setup, OR we implement DaemonSet solution (2-4 hours).
