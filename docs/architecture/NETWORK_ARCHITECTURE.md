# Oceanid Network Architecture

**Last Updated**: 2025-10-13
**Status**: Production Deployed
**K3s Version**: v1.33.4+k3s1

---

## Table of Contents

1. [Overview](#overview)
2. [Physical Network Topology](#physical-network-topology)
3. [Kubernetes Network Architecture](#kubernetes-network-architecture)
4. [Tailscale Mesh Network](#tailscale-mesh-network)
5. [Ingress & Egress Patterns](#ingress--egress-patterns)
6. [Service Mesh & Internal Routing](#service-mesh--internal-routing)
7. [Security Zones & Firewall Rules](#security-zones--firewall-rules)
8. [DNS Resolution](#dns-resolution)
9. [Network Troubleshooting](#network-troubleshooting)

---

## Overview

The Oceanid infrastructure uses a **multi-layered network architecture** combining:

- **K3s Kubernetes** (v1.33.4) with Flannel CNI
- **Tailscale mesh network** for unified egress and secure inter-node communication
- **Cloudflare WARP** for secure cluster access from developer workstations
- **Cloudflare Tunnel** for public ingress to services
- **CrunchyBridge PostgreSQL** with IP allowlist firewall

### Network Layers

```mermaid
graph TB
    subgraph "Layer 4: Application"
        LS[Label Studio]
        PB[Project Bootstrapper]
        CS[CSV Worker]
    end

    subgraph "Layer 3: Service Mesh"
        SVC[ClusterIP Services]
        DNS[CoreDNS]
    end

    subgraph "Layer 2: Kubernetes Networking"
        POD[Pod Network<br/>10.42.0.0/16]
        CLUS[Service Network<br/>10.43.0.0/16]
    end

    subgraph "Layer 1: Physical + Overlay"
        PHYS[Physical NICs<br/>157.173.210.123<br/>192.168.2.80<br/>191.101.1.3]
        TS[Tailscale Mesh<br/>100.x.x.x]
    end

    LS --> SVC
    PB --> SVC
    CS --> SVC
    SVC --> DNS
    SVC --> POD
    POD --> CLUS
    POD --> TS
    TS --> PHYS
```

---

## Physical Network Topology

### Node Inventory

```mermaid
graph LR
    subgraph "Internet"
        INET[Public Internet]
    end

    subgraph "Hetzner Cloud"
        TETHYS[srv712429 - tethys<br/>Control Plane<br/>157.173.210.123<br/>Ubuntu 25.04]
        STYX[srv712695 - styx<br/>Worker<br/>191.101.1.3<br/>Ubuntu 25.04<br/>Status: DOWN]
    end

    subgraph "Private Network"
        CALYPSO[calypso<br/>GPU Worker<br/>192.168.2.80<br/>Ubuntu 24.04<br/>NVIDIA GPU]
    end

    INET --> TETHYS
    INET --> STYX
    TETHYS -.Private.-> CALYPSO
    STYX -.Private.-> CALYPSO
```

| Node | Hostname | Role | IP Address | Public IP | Status | GPU |
|------|----------|------|------------|-----------|--------|-----|
| srv712429 | tethys | Control Plane + Master | 157.173.210.123 | 157.173.210.123 | ✅ Ready | No |
| srv712695 | styx | Worker | 191.101.1.3 | 191.101.1.3 | ❌ NotReady | No |
| calypso | calypso | GPU Worker | 192.168.2.80 | None (private) | ✅ Ready | NVIDIA T600 |

### Network Characteristics

- **Tethys**: Hetzner Cloud VPS, full internet connectivity
- **Styx**: Hetzner Cloud VPS, full internet connectivity (currently DOWN)
- **Calypso**: Private network, no direct internet access (uses NAT/proxy)

---

## Kubernetes Network Architecture

### CNI: Flannel (VXLAN Mode)

K3s uses **Flannel** as the default CNI plugin in **VXLAN mode**.

```mermaid
graph TB
    subgraph "Node: tethys (157.173.210.123)"
        TPOD1[Pod 10.42.0.x]
        TPOD2[Pod 10.42.0.y]
        TFLANNEL[flannel.1<br/>10.42.0.0/24]
    end

    subgraph "Node: calypso (192.168.2.80)"
        CPOD1[Pod 10.42.2.x]
        CPOD2[Pod 10.42.2.y]
        CFLANNEL[flannel.1<br/>10.42.2.0/24]
    end

    TPOD1 --> TFLANNEL
    TPOD2 --> TFLANNEL
    CPOD1 --> CFLANNEL
    CPOD2 --> CFLANNEL

    TFLANNEL <-->|VXLAN Tunnel<br/>UDP 8472| CFLANNEL
```

### IP Address Ranges

| CIDR | Purpose | Allocated To |
|------|---------|--------------|
| `10.42.0.0/16` | **Pod Network** | K3s Pods (Flannel) |
| `10.42.0.0/24` | Pod subnet (tethys) | Pods on srv712429 |
| `10.42.1.0/24` | Pod subnet (styx) | Pods on srv712695 (down) |
| `10.42.2.0/24` | Pod subnet (calypso) | Pods on calypso |
| `10.43.0.0/16` | **Service Network** | ClusterIP Services |
| `10.43.0.1` | Kubernetes API | kube-apiserver |
| `10.43.0.10` | CoreDNS | DNS resolution |
| `100.64.0.0/10` | **Tailscale CGNAT** | Tailscale mesh IPs |
| `100.121.150.65` | Tailscale (tethys) | Exit node |
| `100.118.9.56` | Tailscale (calypso) | Worker node |

### Service Network Details

```mermaid
graph LR
    subgraph "Service CIDR: 10.43.0.0/16"
        K8SAPI[10.43.0.1:443<br/>kubernetes]
        COREDNS[10.43.0.10:53<br/>kube-dns]
        LS[10.43.71.170:8080<br/>label-studio-ls-app]
    end

    subgraph "Pods"
        POD1[10.42.x.x]
        POD2[10.42.y.y]
    end

    POD1 -->|ClusterIP| K8SAPI
    POD1 -->|DNS Query| COREDNS
    POD2 -->|HTTP| LS
```

**Key Services**:
- `kubernetes.default.svc.cluster.local` → 10.43.0.1:443 (API Server)
- `kube-dns.kube-system.svc.cluster.local` → 10.43.0.10:53 (CoreDNS)
- `label-studio-ls-app.apps.svc.cluster.local` → 10.43.71.170:8080

---

## Tailscale Mesh Network

### Architecture: DaemonSet-Based Deployment

As of 2025-10-13, Tailscale is deployed via **Kubernetes DaemonSets** (not host-level installation).

```mermaid
graph TB
    subgraph "Tailscale Control Plane"
        TSCTL[Tailscale<br/>login.tailscale.com]
        DERP[DERP Relay Servers<br/>derp-1.tailscale.com NYC]
    end

    subgraph "Node: tethys (Exit Node)"
        TSPOD1[tailscale-exit-node<br/>DaemonSet Pod<br/>HostNetwork: true]
        TSTUN1[tailscale0 TUN]
        TSIP1[100.121.150.65]
    end

    subgraph "Node: calypso (Worker)"
        TSPOD2[tailscale-worker<br/>DaemonSet Pod<br/>HostNetwork: true]
        TSTUN2[tailscale0 TUN]
        TSIP2[100.118.9.56]
    end

    TSPOD1 --> TSTUN1
    TSPOD1 --> TSIP1
    TSPOD2 --> TSTUN2
    TSPOD2 --> TSIP2

    TSIP1 <-->|Encrypted WireGuard| DERP
    TSIP2 <-->|Encrypted WireGuard| DERP
    TSIP1 <-.Direct P2P.-> TSIP2

    TSPOD1 -.Authenticate.-> TSCTL
    TSPOD2 -.Authenticate.-> TSCTL
```

### Tailscale Network Topology

| Node | Tailscale Hostname | Tailscale IP | Exit Node | Routes Advertised |
|------|--------------------|--------------|-----------|-------------------|
| tethys | srv712429 | 100.121.150.65 | **Yes** (self) | 10.42.0.0/16, 10.43.0.0/16 |
| calypso | calypso | 100.118.9.56 | No (pending) | None |
| styx | srv712695-styx | (offline) | No | None |

### Exit Node Architecture (Unified Egress)

```mermaid
sequenceDiagram
    participant CalypsoPod as Pod on Calypso
    participant TailscaleWorker as Tailscale Worker<br/>(calypso)
    participant TailscaleExit as Tailscale Exit Node<br/>(tethys)
    participant Internet as Internet<br/>(CrunchyBridge, S3)

    Note over CalypsoPod,TailscaleWorker: Traffic initiated from calypso pod
    CalypsoPod->>TailscaleWorker: Route via tailscale0 TUN
    TailscaleWorker->>TailscaleExit: Encrypted WireGuard tunnel
    TailscaleExit->>Internet: Source IP: 157.173.210.123
    Internet->>TailscaleExit: Response
    TailscaleExit->>TailscaleWorker: Encrypted response
    TailscaleWorker->>CalypsoPod: Deliver to pod

    Note over CalypsoPod,Internet: All egress appears as 157.173.210.123
```

**Benefits**:
- ✅ **Unified Egress IP**: All cluster traffic appears as `157.173.210.123`
- ✅ **Single Firewall Entry**: CrunchyBridge allowlist only needs one IP
- ✅ **Private Node Support**: Calypso (no public IP) can reach external services
- ✅ **Encrypted Transit**: WireGuard encryption for inter-node traffic

**Status**:
- ⚠️ Exit node routing **NOT YET ENABLED** (pending Tailscale admin approval)
- Workers authenticated but not configured to use exit node yet
- See [TAILSCALE_DAEMONSET_SUCCESS.md](../../TAILSCALE_DAEMONSET_SUCCESS.md) for activation steps

### Tailscale ACL Policy

Managed in `policy.hujson` and synced via GitHub Actions:

```hujson
{
  "tagOwners": {
    "tag:k8s": ["autogroup:admin"],
    "tag:k8s-operator": ["autogroup:admin"]
  },
  "grants": [
    // K8s devices can access everything (for database, S3)
    {"src": ["tag:k8s"], "dst": ["*"], "ip": ["*"]},
    // Members can access K8s services (Label Studio UI)
    {"src": ["autogroup:member"], "dst": ["tag:k8s"], "ip": ["*"]}
  ]
}
```

---

## Ingress & Egress Patterns

### Ingress: Multiple Entry Points

```mermaid
graph TB
    subgraph "External Clients"
        DEV[Developer Laptop<br/>via WARP]
        PUBLIC[Public Users<br/>via Internet]
    end

    subgraph "Ingress Layer"
        WARP[Cloudflare WARP<br/>Zero Trust Tunnel<br/>10.42.x.x, 10.43.x.x]
        CFTUN[Cloudflare Tunnel<br/>cloudflared]
    end

    subgraph "Kubernetes Cluster"
        K8SAPI[Kubernetes API<br/>10.43.0.1:443]
        LSSVC[Label Studio Service<br/>10.43.71.170:8080]
    end

    DEV -->|Private Routes| WARP
    PUBLIC -->|HTTPS| CFTUN
    WARP --> K8SAPI
    WARP --> LSSVC
    CFTUN --> LSSVC
```

#### 1. Cloudflare WARP (Developer Access)

**Purpose**: Secure private network access for developers to reach cluster services.

**How it works**:
- Developer workstation connects to Cloudflare WARP client
- WARP client enrolled in `goldfishinc` Zero Trust organization
- Split tunnel policy routes cluster CIDRs through WARP:
  - `10.42.0.0/16` (Pod Network)
  - `10.43.0.0/16` (Service Network)
  - `192.168.2.0/24` (Private network - calypso)

**Configuration**:
- Organization: `goldfishinc.cloudflareaccess.com`
- Mode: Gateway with WARP (Layer 4 routing, not TLS termination)
- Authentication: Zero Trust device enrollment

**Usage**:
```bash
# Connect to WARP
warp-cli connect

# Access Kubernetes API directly
export KUBECONFIG=~/.kube/k3s-warp.yaml
kubectl get nodes  # Routes to 10.43.0.1 via WARP

# Access Label Studio (no public tunnel needed)
curl http://label-studio-ls-app.apps.svc.cluster.local:8080/health
```

**Advantages**:
- ✅ No SSH tunnels required
- ✅ Client certificates work end-to-end
- ✅ Automatic reconnection
- ✅ Works from any network (cafe, home, office)

#### 2. Cloudflare Tunnel (Public Ingress)

**Purpose**: Expose Label Studio web UI to public internet.

**How it works**:
- `cloudflared` daemon runs as Deployment in cluster
- Establishes outbound-only connection to Cloudflare edge
- No inbound firewall ports opened on cluster nodes
- Cloudflare edge terminates TLS, proxies to cluster

**Architecture**:
```mermaid
sequenceDiagram
    participant User as Public User
    participant CFEdge as Cloudflare Edge<br/>labelstudio.oceanid.io
    participant CFDaemon as cloudflared<br/>(in cluster)
    participant LSSVC as Label Studio Service<br/>10.43.71.170:8080

    User->>CFEdge: HTTPS request
    CFEdge->>CFDaemon: Proxied request<br/>(via QUIC tunnel)
    CFDaemon->>LSSVC: HTTP to ClusterIP
    LSSVC->>CFDaemon: Response
    CFDaemon->>CFEdge: Proxied response
    CFEdge->>User: HTTPS response
```

**Configuration**:
- Public hostname: `labelstudio.oceanid.io` (example)
- Tunnel token: Stored in Pulumi ESC secret `cloudflareTunnelToken`
- Backend: `http://label-studio-ls-app.apps.svc.cluster.local:8080`

**Advantages**:
- ✅ Zero inbound firewall rules
- ✅ DDoS protection via Cloudflare
- ✅ Automatic TLS certificates
- ✅ WAF and bot protection available

### Egress: Unified Exit Node

```mermaid
graph LR
    subgraph "Kubernetes Cluster"
        POD1[Pod on tethys<br/>10.42.0.x]
        POD2[Pod on calypso<br/>10.42.2.x]
    end

    subgraph "Tailscale Mesh"
        TSEXIT[Tailscale Exit Node<br/>tethys<br/>100.121.150.65]
    end

    subgraph "External Services"
        CB[CrunchyBridge<br/>18.116.211.217:5432]
        S3[AWS S3<br/>labelstudio-goldfish-uploads]
        HF[Hugging Face<br/>hf.co]
    end

    POD1 -->|Direct| TSEXIT
    POD2 -->|Via Tailscale| TSEXIT
    TSEXIT -->|Source: 157.173.210.123| CB
    TSEXIT -->|Source: 157.173.210.123| S3
    TSEXIT -->|Source: 157.173.210.123| HF
```

**Status**: ⚠️ **Exit node routing NOT YET ACTIVE** (see audit report)

**When enabled**:
- All pods route external traffic via Tailscale exit node on tethys
- External services see source IP: `157.173.210.123`
- CrunchyBridge firewall needs only one allowlist entry

---

## Service Mesh & Internal Routing

### CoreDNS Resolution

```mermaid
graph TB
    POD[Pod: project-bootstrapper<br/>10.42.0.234]
    COREDNS[CoreDNS<br/>10.43.0.10:53]
    SVCIP[Service: label-studio-ls-app<br/>10.43.71.170:8080]
    ENDPOINT[Endpoint: Pod 10.42.0.226<br/>label-studio container]

    POD -->|1. DNS Query<br/>label-studio-ls-app.apps.svc.cluster.local| COREDNS
    COREDNS -->|2. A Record<br/>10.43.71.170| POD
    POD -->|3. HTTP Request<br/>10.43.71.170:8080| SVCIP
    SVCIP -->|4. kube-proxy NAT<br/>DNAT to 10.42.0.226| ENDPOINT
```

### Service Discovery Patterns

**Fully Qualified Domain Name (FQDN)**:
```
<service>.<namespace>.svc.cluster.local
```

Examples:
- `label-studio-ls-app.apps.svc.cluster.local` → Label Studio service
- `kubernetes.default.svc.cluster.local` → Kubernetes API
- `kube-dns.kube-system.svc.cluster.local` → CoreDNS

**Short Names** (within same namespace):
```
<service>
```

Example from `apps` namespace:
- `label-studio-ls-app` → Resolves to Label Studio in same namespace

### Service Types

| Type | Purpose | Example | IP Allocation |
|------|---------|---------|---------------|
| ClusterIP | Internal cluster services | label-studio-ls-app | 10.43.x.x |
| NodePort | Expose on node IP:port | (not used) | N/A |
| LoadBalancer | Cloud LB integration | (not used) | N/A |
| ExternalName | CNAME to external DNS | (not used) | N/A |

**Note**: We use **ClusterIP** exclusively, with ingress via Cloudflare Tunnel or WARP.

---

## Security Zones & Firewall Rules

### Network Security Model

```mermaid
graph TB
    subgraph "Public Zone"
        INTERNET[Internet]
    end

    subgraph "DMZ Zone"
        CFEDGE[Cloudflare Edge]
        CFTUN[Cloudflare Tunnel<br/>cloudflared]
    end

    subgraph "Cluster Zone - Untrusted"
        PUBLICPODS[Public-Facing Pods<br/>Label Studio UI]
    end

    subgraph "Cluster Zone - Trusted"
        INTERNALPODS[Internal Services<br/>Project Bootstrapper<br/>CSV Worker]
        COREDNS[CoreDNS]
        K8SAPI[Kubernetes API]
    end

    subgraph "Data Zone"
        CB[CrunchyBridge PostgreSQL<br/>Encrypted TLS]
        S3[AWS S3<br/>Encrypted TLS]
    end

    INTERNET --> CFEDGE
    CFEDGE --> CFTUN
    CFTUN --> PUBLICPODS
    PUBLICPODS --> INTERNALPODS
    INTERNALPODS --> COREDNS
    INTERNALPODS --> K8SAPI
    INTERNALPODS --> CB
    INTERNALPODS --> S3
```

### CrunchyBridge Firewall

**Network**: `ebisu-network` (ID: `ooer7tenangenjelkxbkgz6sdi`)

**Current Allowlist** (as of 2025-10-13):
| CIDR | Description | Justification |
|------|-------------|---------------|
| `157.173.210.123/32` | Unified K8s egress via Tailscale (tethys) | Exit node public IP |

**Pending Removal** (once exit node active):
| CIDR | Description | Reason for Removal |
|------|-------------|-------------------|
| `191.101.1.3/32` | Legacy styx direct egress | Node down, replaced by unified egress |
| `192.168.2.80/32` | Legacy calypso direct egress | Replaced by unified egress |

**Database Endpoint**:
- Host: `p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com`
- Port: `5432`
- TLS: Required (`sslmode=require`)

### Kubernetes Network Policies

**Status**: ⚠️ **NOT YET IMPLEMENTED**

**Recommended Policies** (future enhancement):

1. **Deny all ingress by default** (namespace-scoped)
2. **Allow CoreDNS** from all pods
3. **Allow Label Studio → PostgreSQL** only
4. **Deny pod-to-pod** across namespaces (except explicitly allowed)

Example policy (not yet deployed):
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
  namespace: apps
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

---

## DNS Resolution

### Resolution Flow

```mermaid
sequenceDiagram
    participant Pod as Pod (10.42.x.x)
    participant Resolver as /etc/resolv.conf<br/>nameserver 10.43.0.10
    participant CoreDNS as CoreDNS (10.43.0.10)
    participant External as External DNS<br/>(8.8.8.8)

    Pod->>Resolver: lookup label-studio-ls-app.apps.svc.cluster.local
    Resolver->>CoreDNS: DNS query
    CoreDNS->>CoreDNS: Check cluster.local zone
    CoreDNS->>Pod: A record: 10.43.71.170

    Pod->>Resolver: lookup github.com
    Resolver->>CoreDNS: DNS query
    CoreDNS->>CoreDNS: Not in cluster.local
    CoreDNS->>External: Forward query
    External->>CoreDNS: A record: 140.82.121.4
    CoreDNS->>Pod: A record: 140.82.121.4
```

### CoreDNS Configuration

**Corefile** (default K3s config):
```
.:53 {
    errors
    health {
        lameduck 5s
    }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
        pods insecure
        fallthrough in-addr.arpa ip6.arpa
        ttl 30
    }
    prometheus :9153
    forward . /etc/resolv.conf
    cache 30
    loop
    reload
    loadbalance
}
```

**Key Features**:
- Serves `.cluster.local` zone from Kubernetes API
- Forwards external queries to upstream (8.8.8.8, 8.8.4.4)
- Cache TTL: 30 seconds
- Health checks on `:8080/health`

### DNS Search Domains

Pods in `apps` namespace have the following search domains:
```
search apps.svc.cluster.local svc.cluster.local cluster.local
```

**Resolution order**:
1. `label-studio-ls-app` → tries `label-studio-ls-app.apps.svc.cluster.local` ✅
2. `label-studio-ls-app` → tries `label-studio-ls-app.svc.cluster.local`
3. `label-studio-ls-app` → tries `label-studio-ls-app.cluster.local`
4. `label-studio-ls-app` → tries external DNS

---

## Network Troubleshooting

### Common Issues & Diagnostics

#### Issue 1: "network is unreachable" from pods

**Symptoms**:
```
dial tcp 10.43.71.170:80: connect: network is unreachable
```

**Possible Causes**:
1. Flannel VXLAN tunnel down between nodes
2. Node routing table corrupted
3. IP forwarding disabled on node

**Diagnostics**:
```bash
# Check Flannel on node
ip addr show flannel.1
ip route | grep 10.42

# Check IP forwarding
sysctl net.ipv4.ip_forward
sysctl net.ipv6.conf.all.forwarding

# Check VXLAN tunnel
ip -d link show flannel.1

# Test connectivity between nodes
kubectl run nettest --rm -i --image=nicolaka/netshoot -- ping 10.42.0.1
```

**Fix**:
```bash
# Restart Flannel (K3s)
systemctl restart k3s  # Control plane
systemctl restart k3s-agent  # Worker nodes
```

#### Issue 2: DNS resolution failing

**Symptoms**:
```
dial tcp: lookup label-studio-ls-app on 10.43.0.10:53: no such host
```

**Diagnostics**:
```bash
# Check CoreDNS pods
kubectl get pods -n kube-system -l k8s-app=kube-dns

# Test DNS from pod
kubectl run dnstest --rm -i --image=busybox -- nslookup kubernetes.default

# Check CoreDNS logs
kubectl logs -n kube-system -l k8s-app=kube-dns
```

**Fix**:
```bash
# Restart CoreDNS
kubectl rollout restart deployment/coredns -n kube-system
```

#### Issue 3: Service not routing to pods

**Symptoms**:
- Service exists but connection refused
- Endpoint list is empty

**Diagnostics**:
```bash
# Check service
kubectl get svc label-studio-ls-app -n apps

# Check endpoints (backing pods)
kubectl get endpoints label-studio-ls-app -n apps

# Verify pod selector matches
kubectl get svc label-studio-ls-app -n apps -o yaml | grep selector
kubectl get pods -n apps -l app.kubernetes.io/name=ls-app
```

**Fix**:
- Ensure pod labels match service selector
- Check pod readiness probes passing

#### Issue 4: Tailscale exit node not routing

**Symptoms**:
- Pods show non-unified egress IP
- Database connections failing despite unified IP in allowlist

**Diagnostics**:
```bash
# Check Tailscale status
kubectl -n tailscale-system exec tailscale-exit-node-xxx -- tailscale status

# Verify exit node advertising
kubectl -n tailscale-system logs tailscale-exit-node-xxx | grep "exit-node"

# Test egress from specific node
kubectl run egress-test --rm -i --image=curlimages/curl:latest \
  --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"calypso"}}}' \
  -- curl -s https://ipinfo.io/ip
```

**Fix**:
- See [AUDIT_REPORT_TAILSCALE_DAEMONSET.md](../../AUDIT_REPORT_TAILSCALE_DAEMONSET.md) for activation checklist

### Network Debugging Tools

**Install netshoot pod**:
```bash
kubectl run netshoot --rm -i --image=nicolaka/netshoot -- /bin/bash
```

**Available tools in netshoot**:
- `curl`, `wget` - HTTP testing
- `nslookup`, `dig` - DNS debugging
- `ping`, `traceroute` - ICMP testing
- `nc` (netcat) - Port scanning
- `tcpdump` - Packet capture
- `iperf3` - Bandwidth testing

**Example diagnostics**:
```bash
# Test service connectivity
kubectl run netshoot --rm -i --image=nicolaka/netshoot -- \
  curl -v http://label-studio-ls-app.apps.svc.cluster.local:8080/health

# Test DNS resolution
kubectl run netshoot --rm -i --image=nicolaka/netshoot -- \
  nslookup label-studio-ls-app.apps.svc.cluster.local

# Test database connectivity
kubectl run netshoot --rm -i --image=nicolaka/netshoot -- \
  nc -zv p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com 5432
```

---

## Appendix: Network Flow Examples

### Example 1: Developer kubectl Command

```mermaid
sequenceDiagram
    participant Dev as Developer Laptop<br/>(WARP Connected)
    participant WARP as Cloudflare WARP<br/>Gateway
    participant K8SAPI as Kubernetes API<br/>10.43.0.1:443<br/>(on tethys)

    Dev->>WARP: kubectl get pods<br/>Destination: 10.43.0.1
    WARP->>WARP: Route via private tunnel<br/>(10.43.0.0/16 in split tunnel)
    WARP->>K8SAPI: TLS request<br/>Client cert auth
    K8SAPI->>K8SAPI: Verify client cert
    K8SAPI->>WARP: Pod list response
    WARP->>Dev: Display pods
```

### Example 2: Label Studio Database Query

```mermaid
sequenceDiagram
    participant LS as Label Studio Pod<br/>10.42.0.226<br/>(on tethys)
    participant TSEXIT as Tailscale Exit Node<br/>100.121.150.65
    participant CB as CrunchyBridge<br/>18.116.211.217:5432

    Note over LS,CB: NOT YET ACTIVE (exit node routing pending)

    LS->>LS: Resolve p.xxx.db.postgresbridge.com<br/>via CoreDNS
    LS->>TSEXIT: Route via tailscale0<br/>(when exit node enabled)
    TSEXIT->>CB: TLS connection<br/>Source: 157.173.210.123
    CB->>CB: Check firewall allowlist<br/>157.173.210.123/32 ✅
    CB->>TSEXIT: PostgreSQL response
    TSEXIT->>LS: Deliver to pod
```

### Example 3: Public User Accessing Label Studio

```mermaid
sequenceDiagram
    participant User as Public User<br/>Browser
    participant CFEdge as Cloudflare Edge<br/>labelstudio.oceanid.io
    participant CFTun as cloudflared Pod<br/>10.42.x.x
    participant LSSVC as Label Studio Service<br/>10.43.71.170:8080
    participant LSPod as Label Studio Pod<br/>10.42.0.226

    User->>CFEdge: HTTPS GET /projects
    CFEdge->>CFEdge: Terminate TLS
    CFEdge->>CFTun: QUIC tunnel
    CFTun->>LSSVC: HTTP to ClusterIP
    LSSVC->>LSPod: kube-proxy NAT
    LSPod->>LSPod: Django handler
    LSPod->>LSSVC: HTTP 200 response
    LSSVC->>CFTun: Response
    CFTun->>CFEdge: QUIC tunnel
    CFEdge->>User: HTTPS response
```

---

## References

- [TAILSCALE_DAEMONSET_SUCCESS.md](../../TAILSCALE_DAEMONSET_SUCCESS.md) - Tailscale implementation details
- [AUDIT_REPORT_TAILSCALE_DAEMONSET.md](../../AUDIT_REPORT_TAILSCALE_DAEMONSET.md) - Network security audit
- [K3s Networking](https://docs.k3s.io/networking) - Flannel configuration
- [Tailscale Kubernetes](https://tailscale.com/kb/1236/kubernetes-operator/) - Mesh networking

---

**Document Status**: ✅ Production Deployed (with pending exit node activation)
**Last Verified**: 2025-10-13
**Next Review**: After exit node activation
