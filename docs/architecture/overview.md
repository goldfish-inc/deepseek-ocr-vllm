# Oceanid Cluster Architecture

## Network Topology

```mermaid
graph TB
    subgraph "Internet"
        Users[Users/Clients]
        CF[Cloudflare Edge]
        Sentry[Sentry SaaS]
    end

    subgraph "Cloudflare Services"
        WAF[WAF Rules]
        ZT[Zero Trust Access]
        DNS[DNS Management]
        Tunnel[Cloudflare Tunnel]
    end

    subgraph "Oceanid Cluster"
        subgraph "Control Plane - Tethys"
            Master[k3s Master<br/>157.173.210.123]
            ETCD[etcd Database]
            API[API Server<br/>:6443]
            Scheduler[Scheduler]
            CM[Controller Manager]
        end

        subgraph "Worker Node - Styx"
            Worker1[k3s Worker<br/>191.101.1.3]
            Pods1[Application Pods]
        end

        subgraph "Worker Node - Meliae"
            Worker2[k3s Worker<br/>140.238.138.35]
            Pods2[Application Pods]
        end

        subgraph "GPU Node - Calypso"
            Worker3[k3s Worker<br/>192.168.2.68]
            GPU[RTX 4090]
            MLPods[ML Workloads]
        end
    end

    subgraph "Infrastructure as Code"
        Pulumi[Pulumi Engine]
        ESC[Pulumi ESC<br/>Secrets & Config]
        Git[GitHub Repository]
    end

    subgraph "Security Layers"
        FW[UFW Firewalls]
        NP[Network Policies]
        RBAC[RBAC Policies]
        Rotation[Key/Cert Rotation]
    end

    Users --> CF
    CF --> WAF
    WAF --> ZT
    ZT --> DNS
    DNS --> Tunnel
    Tunnel --> Master

    Master --> Worker1
    Master --> Worker2
    Master --> Worker3

    API --> ETCD
    Scheduler --> API
    CM --> API

    Worker1 --> Pods1
    Worker2 --> Pods2
    Worker3 --> MLPods
    Worker3 --> GPU

    Pulumi --> ESC
    Pulumi --> Git
    Pulumi --> Master

    ESC -.->|Secrets| Master
    ESC -.->|SSH Keys| Worker1
    ESC -.->|SSH Keys| Worker2
    ESC -.->|SSH Keys| Worker3

    Master -->|Monitoring| Sentry
    Worker1 -->|Errors| Sentry
    Worker2 -->|Errors| Sentry

    FW -.->|Protects| Master
    FW -.->|Protects| Worker1
    FW -.->|Protects| Worker2
    FW -.->|Protects| Worker3

    NP -.->|Isolates| Pods1
    NP -.->|Isolates| Pods2
    NP -.->|Isolates| MLPods

    style CF fill:#f9a825
    style WAF fill:#ff6b6b
    style ZT fill:#4ecdc4
    style Master fill:#95e77e
    style Worker1 fill:#a8dadc
    style Worker2 fill:#a8dadc
    style Worker3 fill:#ffd93d
    style GPU fill:#ff6b6b
    style ESC fill:#6c5ce7
    style Sentry fill:#9b59b6
```

## Calypso Access Path (GPU)

```mermaid
sequenceDiagram
  participant LS as Label Studio (K8s)
  participant AD as Adapter (K8s)
  participant CF as Cloudflare Edge
  participant CL as cloudflared (Calypso)
  participant TR as Triton (Calypso)

  LS->>AD: ML backend /predict (JSON)
  AD->>CF: HTTPS https://gpu.<base>
  CF->>CL: Node Tunnel connection (auth via credentials.json/token)
  CL->>TR: http://localhost:8000/v2/... (HTTP v2)
  TR-->>CL: logits
  CL-->>CF: response
  CF-->>AD: 200 + logits
  AD-->>LS: pre-labels
```

Component ownership:

- Pulumi `HostCloudflared` ensures systemd unit + config on Calypso.
- Pulumi `HostDockerService` ensures `tritonserver.service` with GPU flags.
- DNS `gpu.<base>` CNAME is created when NodeTunnels are disabled (host connector path) or by NodeTunnels component otherwise.


## Traffic Flow

```mermaid
sequenceDiagram
    participant User
    participant Cloudflare
    participant Tunnel
    participant Gateway
    participant Service
    participant Pod

    User->>Cloudflare: HTTPS Request
    Cloudflare->>Cloudflare: WAF Check
    Cloudflare->>Cloudflare: Zero Trust Auth
    Cloudflare->>Tunnel: Proxied Request
    Tunnel->>Gateway: Internal Request
    Gateway->>Service: Route to Service
    Service->>Pod: Load Balance
    Pod-->>Service: Response
    Service-->>Gateway: Response
    Gateway-->>Tunnel: Response
    Tunnel-->>Cloudflare: Response
    Cloudflare-->>User: HTTPS Response
```

## Security Architecture

```mermaid
graph LR
    subgraph "External Security"
        A[Cloudflare WAF] --> B[DDoS Protection]
        B --> C[Bot Management]
        C --> D[Zero Trust Access]
    end

    subgraph "Network Security"
        E[UFW Firewall] --> F[Network Policies]
        F --> G[Service Mesh<br/>*Future*]
        G --> H[mTLS]
    end

    subgraph "Application Security"
        I[RBAC] --> J[Pod Security]
        J --> K[Secret Management]
        K --> L[Image Scanning<br/>*Future*]
    end

    subgraph "Data Security"
        M[Encryption at Rest] --> N[Encryption in Transit]
        N --> O[Key Rotation]
        O --> P[Backup Encryption]
    end

    D --> E
    H --> I
    L --> M
```

## Component Overview

### Core Infrastructure

- **K3s**: Lightweight Kubernetes distribution
- **Cloudflare Tunnel**: Secure ingress without exposed IPs
- **Gateway API**: Modern ingress management (2025 standard)
- **cert-manager**: Automatic TLS certificate management

### Node Configuration

| Node | Role | IP | Provider | Resources | Purpose |
|------|------|-----|----------|-----------|---------|
| Tethys | Control Plane | 157.173.210.123 | Hostinger | 2 vCPU, 2GB RAM | Master node |
| Styx | Worker | 191.101.1.3 | Hostinger | 2 vCPU, 2GB RAM | Application workloads |
| Meliae | Worker | 140.238.138.35 | Oracle Cloud | 1 OCPU, 1GB RAM | Light workloads |
| Calypso | GPU Worker | 192.168.2.68 | Local | RTX 4090, 32GB RAM | ML/AI workloads |

### Security Features

- **Zero-Trust Architecture**: No implicit trust
- **Network Segmentation**: Namespace isolation
- **Automatic Rotation**: 90-day SSH, 90-day TLS, 365-day K3s
- **External Monitoring**: Sentry (no cluster overhead)
- **Firewall Layers**: Cloudflare WAF + UFW + NetworkPolicies

### Infrastructure as Code

- **Pulumi**: TypeScript-based IaC
- **ESC**: Environment, Secrets, Configuration management
- **GitOps Ready**: Prepared for ArgoCD/Flux integration
- **Automated Provisioning**: Node joining automation

## Scalability Design

```mermaid
graph TD
    subgraph "Current State"
        A[4 Nodes<br/>Manual Scaling]
    end

    subgraph "Near Term"
        B[+ Cloud Nodes<br/>Semi-Auto Scaling]
        C[HPA/VPA<br/>Pod Autoscaling]
    end

    subgraph "Future State"
        D[Cluster Autoscaler]
        E[KEDA Event Scaling]
        F[Multi-Region]
    end

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
```

## Deployment Pipeline

```mermaid
graph LR
    A[Developer] --> B[Git Push]
    B --> C[GitHub]
    C --> D[Pulumi Preview]
    D --> E{Approval}
    E -->|Yes| F[Pulumi Up]
    E -->|No| G[Reject]
    F --> H[ESC Secrets]
    H --> I[Deploy to k3s]
    I --> J[Health Check]
    J --> K[Sentry Tracking]
    K --> L[Complete]
```

## Resource Utilization

### Current Usage (Baseline)

- **Control Plane**: ~500MB RAM, 0.5 CPU
- **Worker Nodes**: ~300MB RAM each, 0.2 CPU
- **Total Cluster**: ~1.4GB RAM, 1.1 CPU

### With Monitoring

- **Sentry Relay**: 50MB RAM, 0.05 CPU
- **Error Collector**: 32MB RAM, 0.01 CPU
- **Health Reporter**: 32MB RAM, 0.01 CPU
- **Total Monitoring**: ~114MB RAM, 0.07 CPU

### Reserved for Applications

- **Available RAM**: ~6GB across cluster
- **Available CPU**: ~4 cores
- **GPU**: RTX 4090 (dedicated for ML)

## High Availability Considerations

### Current Limitations

- Single control plane (Tethys)
- No etcd backup automation
- Manual disaster recovery

### Future Improvements

1. Add HA control plane nodes
2. Implement Velero for backups
3. Multi-region deployment
4. Automated failover

## Network Segmentation

```mermaid
graph TB
    subgraph "DMZ"
        CF[Cloudflare Tunnel]
    end

    subgraph "Public Services"
        GW[Gateway]
        Web[Web Apps]
    end

    subgraph "Internal Services"
        API[APIs]
        DB[Databases]
    end

    subgraph "Restricted"
        Secrets[Secret Management]
        Admin[Admin Tools]
    end

    CF --> GW
    GW --> Web
    Web --> API
    API --> DB
    Admin --> Secrets

    style DMZ fill:#ff9999
    style Public fill:#ffcc99
    style Internal fill:#99ccff
    style Restricted fill:#cc99ff
```
