# Future Networking Architecture - Safe Egress Pattern

## Executive Summary

**Goal**: Unified cluster egress through single IP (157.173.210.123) without touching host networking.

**Current Approach (FAILED)**: DaemonSet with `hostNetwork: true` → breaks cluster networking

**New Approach**: Pod-based egress gateway with Kubernetes NetworkPolicies → safe, testable, rollback-friendly

---

## Architecture Principles

### Non-Negotiable Requirements

1. **NO hostNetwork: true**
   - Never manipulate host routing tables
   - Keep pod networking isolated from host networking
   - Preserve kubelet ↔ API server connectivity

2. **NO DaemonSets for egress routing**
   - DaemonSets can't be partially rolled out
   - Single egress gateway pod is sufficient
   - Easier to test and rollback

3. **Incremental rollout**
   - Test on single pod first
   - Verify connectivity before expanding
   - Keep rollback path clear

4. **Preserve cluster networking**
   - Don't route K8s service traffic through egress gateway
   - Only route external egress (database, S3, internet)
   - Let CNI handle intra-cluster traffic

---

## Recommended Architecture: Egress Gateway Pod

### Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Kubernetes Cluster                                          │
│                                                             │
│  ┌─────────────┐          ┌──────────────────┐            │
│  │   Worker    │          │  Egress Gateway  │            │
│  │    Pods     │──────────▶│   (on tethys)   │──────┐     │
│  │             │ External  │                  │      │     │
│  │ - LS Worker │  traffic  │  - Tailscale     │      │     │
│  │ - CSV Sink  │   only    │  - SNAT/routing  │      │     │
│  └─────────────┘           └──────────────────┘      │     │
│                                                       │     │
│  Internal K8s traffic (pod↔pod, pod↔service)         │     │
│  flows directly via CNI (no gateway)                 │     │
└──────────────────────────────────────────────────────┼─────┘
                                                       │
                                                       ▼
                                           ┌────────────────────┐
                                           │  External Services │
                                           │  - CrunchyBridge   │
                                           │  - S3              │
                                           │  - Internet        │
                                           │                    │
                                           │  See source IP:    │
                                           │  157.173.210.123   │
                                           └────────────────────┘
```

### Components

#### 1. Egress Gateway Deployment (NOT DaemonSet)

**File**: `infrastructure/egress-gateway.yaml`

```yaml
---
apiVersion: v1
kind: Namespace
metadata:
  name: egress-system
  labels:
    pod-security.kubernetes.io/enforce: baseline
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: egress-gateway
  namespace: egress-system
---
# Deployment (single replica, pinned to tethys)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: egress-gateway
  namespace: egress-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: egress-gateway
  template:
    metadata:
      labels:
        app: egress-gateway
    spec:
      serviceAccountName: egress-gateway
      # Pin to tethys (exit node with public IP)
      nodeSelector:
        oceanid.node/name: tethys
      # Use pod networking (NOT hostNetwork)
      hostNetwork: false
      containers:
        - name: gateway
          image: alpine:3.19
          command:
            - /bin/sh
            - -c
            - |
              # Install iptables for NAT
              apk add --no-cache iptables socat curl

              # Enable IP forwarding (pod-level, not host)
              echo 1 > /proc/sys/net/ipv4/ip_forward

              # Set up SNAT (source NAT) to gateway's pod IP
              # This makes all forwarded traffic appear to come from this pod
              iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE

              # Keep container running
              trap 'exit 0' TERM
              tail -f /dev/null & wait
          securityContext:
            capabilities:
              add:
                - NET_ADMIN  # Required for iptables
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 256Mi
          livenessProbe:
            exec:
              command:
                - /bin/sh
                - -c
                - "ip route show | grep default"
            initialDelaySeconds: 10
            periodSeconds: 30
---
# Service to route traffic to gateway
apiVersion: v1
kind: Service
metadata:
  name: egress-gateway
  namespace: egress-system
spec:
  selector:
    app: egress-gateway
  ports:
    - name: proxy
      port: 3128
      targetPort: 3128
      protocol: TCP
  type: ClusterIP
```

**Key Differences from Failed Approach**:
- ✅ `hostNetwork: false` (pod networking only)
- ✅ Deployment not DaemonSet (testable rollout)
- ✅ Single replica (one egress point, simpler)
- ✅ Pinned to tethys via nodeSelector (not all nodes)
- ✅ SNAT within pod (doesn't touch host iptables)

#### 2. NetworkPolicy for Egress Control

**File**: `infrastructure/egress-network-policy.yaml`

```yaml
---
# Allow specific pods to use egress gateway
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: external-egress-via-gateway
  namespace: apps
spec:
  podSelector:
    matchLabels:
      egress: external  # Label pods that need external access
  policyTypes:
    - Egress
  egress:
    # Allow DNS (required)
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53

    # Allow internal cluster traffic (pod-to-pod, pod-to-service)
    - to:
        - podSelector: {}
        - namespaceSelector: {}
      ports:
        - protocol: TCP

    # Route external traffic through gateway
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: egress-system
          podSelector:
            matchLabels:
              app: egress-gateway
      ports:
        - protocol: TCP

    # Block direct external access (force through gateway)
    # This is implicitly denied by default-deny egress policy
```

**How It Works**:
1. Pods labeled `egress: external` can only reach external IPs via gateway
2. Internal K8s traffic (pod↔pod, pod↔service) flows normally
3. DNS works (required for service discovery)
4. All external traffic (database, S3, internet) goes through gateway pod

#### 3. HTTP Proxy for Transparent Routing (Optional)

For applications that don't support NetworkPolicy-based routing:

```yaml
# Add to egress-gateway container
- name: squid-proxy
  image: sameersbn/squid:3.5.27-2
  ports:
    - containerPort: 3128
      name: proxy
  volumeMounts:
    - name: squid-config
      mountPath: /etc/squid
---
# ConfigMap for Squid proxy
apiVersion: v1
kind: ConfigMap
metadata:
  name: squid-config
  namespace: egress-system
data:
  squid.conf: |
    http_port 3128

    # Allow all traffic
    acl all src 0.0.0.0/0
    http_access allow all

    # Forward to Tailscale
    never_direct allow all

    # Cache settings
    cache deny all
```

Then configure pods to use proxy:
```yaml
env:
  - name: HTTP_PROXY
    value: "http://egress-gateway.egress-system.svc.cluster.local:3128"
  - name: HTTPS_PROXY
    value: "http://egress-gateway.egress-system.svc.cluster.local:3128"
  - name: NO_PROXY
    value: ".svc,.svc.cluster.local,10.42.0.0/16,10.43.0.0/16"
```

---

## Migration Path (Safe Rollout)

### Phase 1: Deploy Gateway (No Traffic Yet)

```bash
# Deploy egress gateway (no workloads use it yet)
kubectl apply -f infrastructure/egress-gateway.yaml

# Verify gateway pod is Running
kubectl -n egress-system get pods
kubectl -n egress-system logs deployment/egress-gateway

# Test gateway reachability from test pod
kubectl run nettest --rm -i --image=curlimages/curl:latest --restart=Never -- \
  curl -v --max-time 5 http://egress-gateway.egress-system.svc.cluster.local:3128
```

**Success Criteria**: Gateway pod Running, reachable from other pods.

### Phase 2: Test with Single Pod

```bash
# Label project-bootstrapper to use egress gateway (test pod)
kubectl -n apps label pod -l app=project-bootstrapper egress=external

# Apply NetworkPolicy (only affects labeled pods)
kubectl apply -f infrastructure/egress-network-policy.yaml

# Verify project-bootstrapper still works
kubectl -n apps logs deployment/project-bootstrapper --tail=20
# Should show webhook registration success

# Test external connectivity
kubectl -n apps exec deployment/project-bootstrapper -- \
  wget -qO- --timeout=5 https://ipinfo.io/ip
# Should return 157.173.210.123 (tethys public IP)
```

**Success Criteria**:
- project-bootstrapper connects to Label Studio ✅
- External traffic shows tethys IP ✅
- No CrashLoopBackOff ✅

**If Fails**: Remove label, rollback NetworkPolicy, no harm done.

### Phase 3: Expand to More Pods

```bash
# Label CSV workers
kubectl -n apps label deployment csv-ingestion-worker egress=external

# Label annotations sink
kubectl -n apps label deployment annotations-sink egress=external

# Monitor for issues
kubectl -n apps get pods -l egress=external -w
```

**Success Criteria**: All labeled pods work normally with external access.

### Phase 4: Update CrunchyBridge Firewall

```bash
# Remove old worker node IPs from allowlist
cb network list-firewall-rules --network ooer7tenangenjelkxbkgz6sdi

# Keep only tethys IP
# 157.173.210.123/32 - srv712429 (egress gateway)

# Test database connectivity
kubectl -n apps run db-test --rm -i --image=postgres:16-alpine \
  -l egress=external \
  --command -- sh -c 'pg_isready -h 18.116.211.217'
```

---

## Why This Architecture is Safe

### 1. No Host Networking Manipulation
- ✅ Egress gateway runs in pod network namespace
- ✅ Host routing tables untouched
- ✅ Kubelet ↔ API server connectivity preserved
- ✅ SSH access unaffected

### 2. Incremental Rollout
- ✅ Test on single pod first
- ✅ Expand gradually (label-based)
- ✅ Easy rollback (remove labels)
- ✅ No all-or-nothing deployment

### 3. Cluster Networking Preserved
- ✅ Internal traffic flows normally via CNI
- ✅ Service discovery works
- ✅ DNS resolution unaffected
- ✅ Only external egress is routed

### 4. Observable and Debuggable
- ✅ Single gateway pod to inspect
- ✅ Clear traffic flow (pod → gateway → external)
- ✅ Logs show routing decisions
- ✅ Easy to test with curl/wget

### 5. Rollback Friendly
```bash
# Full rollback in 3 commands:
kubectl delete networkpolicy external-egress-via-gateway -n apps
kubectl -n apps label pods egress-
kubectl delete -f infrastructure/egress-gateway.yaml
```

---

## Alternative Approaches Considered

### Option 1: Istio/Envoy Egress Gateway ❌
**Pros**: Industry standard, well-tested
**Cons**: Heavy (requires Istio control plane), overkill for simple egress routing

### Option 2: Calico/Cilium Network Policies ❌
**Pros**: Native CNI support, performant
**Cons**: Requires replacing K3s Flannel CNI (risky migration)

### Option 3: Tailscale Kubernetes Operator ❌
**Pros**: Official Tailscale support
**Cons**: Uses CRDs and complex operator logic, we already have Tailscale running on host

### Option 4: Host-level Tailscale (Current Failed Approach) ❌
**Pros**: Simplest concept (use host Tailscale)
**Cons**: Breaks cluster networking, no rollback, all-or-nothing deployment

### Option 5: Pod-based Egress Gateway ✅ (Recommended)
**Pros**:
- Simple (single pod, standard K8s primitives)
- Safe (no host networking)
- Testable (label-based rollout)
- Rollback-friendly (delete pod + labels)

**Cons**:
- Requires pod labeling for routing
- Single point of failure (mitigated by Deployment with replicas)

---

## Success Metrics

### Before Implementation
- ❌ Multiple source IPs from cluster (complicates firewall management)
- ❌ No egress traffic visibility
- ❌ Risky host-level networking changes

### After Implementation
- ✅ Single source IP (157.173.210.123)
- ✅ Clear egress traffic path (pod → gateway → external)
- ✅ CrunchyBridge firewall has single entry
- ✅ Safe, incremental rollout with easy rollback
- ✅ No host networking manipulation

---

## Phase 2 Revised: Safe Stabilization Tasks

Now that we have a safe egress architecture, Phase 2 should focus on:

### 2.1 State Drift Resolution ✅
- Audit image tags vs Pulumi config
- Add validation hooks
- **(Already completed in audit)**

### 2.2 Flux Conflicts (#72) ⏭️
- Clean stale ClusterRoles
- Fix Helm ownership metadata
- Test GitOps reconciliation

### 2.3 Configuration Validation ⏭️
- Add URL port validation (prevent #97 repeat)
- Health endpoints for connectivity testing
- Startup checks for required env vars

### 2.4 Documentation ⏭️
- Update CLAUDE.md with incident lessons
- Create node recovery runbook
- Document prohibited patterns (hostNetwork DaemonSets)

### 2.5 Egress Gateway (NEW - Optional) ⏭️
- Deploy egress gateway pod (if unified egress still needed)
- Test with single pod
- Gradually expand rollout

**NO MORE RISKY NETWORKING CHANGES** - Egress gateway is optional and can be deferred to Phase 3.

---

## Approval Required

**Question for user**:

1. Should we proceed with egress gateway implementation now, or defer to Phase 3 (after monitoring)?
2. For calypso recovery: Do you have console/IPMI access, or should we drain and reschedule workloads?

---

**Status**: Awaiting approval
**Next Action**: Execute recovery plan, then implement chosen architecture
**Owner**: @ryan-taylor
