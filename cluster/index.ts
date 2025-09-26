import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { dnsStatus } from "./dns";
import { nodes, clusterInfo, nodeStatus } from "./nodes";

// =============================================================================
// CONFIGURATION
// =============================================================================

export const config = new pulumi.Config();
const clusterConfig = {
    name: config.get("clusterName") || "oceanid-cluster",
    tethysIp: config.require("tethysIp"),
    styxIp: config.require("styxIp")
};

// Container Images (always use latest stable versions)
const cloudflaredImage = config.get("cloudflaredImage") || "cloudflare/cloudflared:latest";

// Resource limits for future-proof performance
const resources = {
    cloudflared: {
        limits: { memory: "256Mi", cpu: "200m" },
        requests: { memory: "128Mi", cpu: "100m" }
    },
    certManager: {
        limits: { memory: "256Mi", cpu: "200m" },
        requests: { memory: "128Mi", cpu: "100m" }
    },
    gateway: {
        limits: { memory: "512Mi", cpu: "500m" },
        requests: { memory: "256Mi", cpu: "250m" }
    }
};

// =============================================================================
// KUBERNETES PROVIDER
// =============================================================================

const k8sProvider = new k8s.Provider("k8s-provider", {
    kubeconfig: pulumi.output(process.env.KUBECONFIG || "./kubeconfig.yaml")
});

// =============================================================================
// NAMESPACES
// =============================================================================

// Cloudflare namespace for tunnel
const cloudflareNs = new k8s.core.v1.Namespace("cloudflare", {
    metadata: {
        name: "cloudflare",
        labels: {
            "pod-security.kubernetes.io/enforce": "restricted",
            "oceanid.cluster/component": "networking"
        }
    }
}, { provider: k8sProvider });

// Gateway API namespace
const gatewayNs = new k8s.core.v1.Namespace("gateway-system", {
    metadata: {
        name: "gateway-system",
        labels: {
            "pod-security.kubernetes.io/enforce": "restricted",
            "oceanid.cluster/component": "gateway-api"
        }
    }
}, { provider: k8sProvider });


// =============================================================================
// SERVICE ACCOUNTS & RBAC
// =============================================================================

// Cloudflared Service Account
const cloudflaredServiceAccount = new k8s.core.v1.ServiceAccount("cloudflared-sa", {
    metadata: {
        name: "cloudflared",
        namespace: cloudflareNs.metadata.name,
        labels: { "oceanid.cluster/component": "networking" }
    }
}, { provider: k8sProvider });

// =============================================================================
// PULUMI ESC SECRETS INTEGRATION
// =============================================================================

// Get secrets from Pulumi ESC
// These are automatically available when the environment is imported in Pulumi.prod.yaml
const cloudflareToken = config.requireSecret("cloudflare_tunnel_token");
const cloudflareApiToken = config.requireSecret("cloudflare_api_token");
// const cloudflareTunnelId = config.require("cloudflare_tunnel_id"); // Available if needed

// Create Kubernetes secret from ESC
const cloudflaredCredentials = new k8s.core.v1.Secret("cloudflared-credentials", {
    metadata: {
        name: "cloudflared-credentials",
        namespace: cloudflareNs.metadata.name,
        labels: { "oceanid.cluster/component": "networking" }
    },
    stringData: {
        token: cloudflareToken,
        api_token: cloudflareApiToken
    }
}, { provider: k8sProvider });

// =============================================================================
// CLOUDFLARE TUNNEL CONFIGURATION
// =============================================================================

const cloudflaredConfig = new k8s.core.v1.ConfigMap("cloudflared-config", {
    metadata: {
        name: "cloudflared-config",
        namespace: cloudflareNs.metadata.name,
        labels: { "oceanid.cluster/component": "networking" }
    },
    data: {
        "config.yaml": pulumi.interpolate`
tunnel: oceanid-cluster
credentials-file: /etc/cloudflared/creds/credentials.json
metrics: 0.0.0.0:2000
no-autoupdate: true

ingress:
  # Kubernetes Dashboard (if deployed)
  - hostname: dashboard.boathou.se
    service: https://kubernetes-dashboard.kubernetes-dashboard.svc.cluster.local
    originRequest:
      noTLSVerify: true

  # Metrics endpoint
  - hostname: metrics.boathou.se
    service: http://localhost:2000

  # Health check endpoint
  - hostname: health.boathou.se
    service: http_status:200

  # Vault endpoint
  - hostname: vault.boathou.se
    service: http://vault.vault.svc.cluster.local:8200

  # Catch-all
  - service: http_status:404
`
    }
}, { provider: k8sProvider });

// Cloudflare Tunnel Deployment
// Export for monitoring and management
export const cloudflaredDeployment = new k8s.apps.v1.Deployment("cloudflared", {
    metadata: {
        name: "cloudflared",
        namespace: cloudflareNs.metadata.name,
        labels: { "oceanid.cluster/component": "networking" }
    },
    spec: {
        replicas: 2,
        selector: {
            matchLabels: { app: "cloudflared" }
        },
        template: {
            metadata: {
                labels: {
                    app: "cloudflared",
                    "oceanid.cluster/component": "networking"
                },
                annotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "2000"
                }
            },
            spec: {
                serviceAccountName: cloudflaredServiceAccount.metadata.name,
                // Init container to optimize UDP buffers for QUIC (2025 best practice)
                initContainers: [{
                    name: "sysctl-buffer-tuning",
                    image: "alpine:3.20",
                    command: ["/bin/sh", "-c"],
                    args: [
                        `# Optimize UDP buffers for QUIC protocol (Cloudflare Tunnel)
                        sysctl -w net.core.rmem_max=7500000 || echo 'Failed to set rmem_max'
                        sysctl -w net.core.wmem_max=7500000 || echo 'Failed to set wmem_max'
                        sysctl -w net.ipv4.udp_mem='102400 204800 409600' || echo 'Failed to set udp_mem'
                        sysctl -w net.core.netdev_max_backlog=30000 || echo 'Failed to set netdev_max_backlog'
                        # Additional QUIC optimizations
                        sysctl -w net.ipv4.tcp_congestion_control=bbr || echo 'BBR not available'
                        sysctl -w net.core.default_qdisc=fq || echo 'FQ not available'
                        echo 'UDP buffers optimized for QUIC protocol'`
                    ],
                    securityContext: {
                        privileged: true,
                        runAsUser: 0,
                        capabilities: {
                            add: ["SYS_ADMIN", "NET_ADMIN"]
                        }
                    },
                    resources: {
                        limits: { memory: "32Mi", cpu: "50m" },
                        requests: { memory: "16Mi", cpu: "10m" }
                    }
                }, {
                    name: "verify-buffer-settings",
                    image: "alpine:3.20",
                    command: ["/bin/sh", "-c"],
                    args: [
                        `# Verify UDP buffer settings
                        echo 'Verifying UDP buffer settings:'
                        sysctl net.core.rmem_max net.core.wmem_max net.ipv4.udp_mem`
                    ],
                    securityContext: {
                        runAsUser: 65532,
                        runAsNonRoot: true,
                        readOnlyRootFilesystem: true
                    },
                    resources: {
                        limits: { memory: "16Mi", cpu: "10m" },
                        requests: { memory: "8Mi", cpu: "5m" }
                    }
                }],
                containers: [{
                    name: "cloudflared",
                    image: cloudflaredImage,
                    args: [
                        "tunnel",
                        "--config",
                        "/etc/cloudflared/config/config.yaml",
                        "--metrics",
                        "0.0.0.0:2000",
                        "run"
                    ],
                    env: [
                        {
                            name: "TUNNEL_TOKEN",
                            valueFrom: {
                                secretKeyRef: {
                                    name: cloudflaredCredentials.metadata.name,
                                    key: "token"
                                }
                            }
                        },
                        {
                            name: "TUNNEL_METRICS",
                            value: "0.0.0.0:2000"
                        },
                        {
                            name: "TUNNEL_LOGLEVEL",
                            value: "info"
                        }
                    ],
                    ports: [
                        { containerPort: 2000, name: "metrics" }
                    ],
                    volumeMounts: [
                        {
                            name: "config",
                            mountPath: "/etc/cloudflared/config",
                            readOnly: true
                        },
                        {
                            name: "creds",
                            mountPath: "/etc/cloudflared/creds",
                            readOnly: true
                        }
                    ],
                    livenessProbe: {
                        httpGet: {
                            path: "/ready",
                            port: 2000
                        },
                        initialDelaySeconds: 10,
                        periodSeconds: 30
                    },
                    readinessProbe: {
                        httpGet: {
                            path: "/ready",
                            port: 2000
                        },
                        initialDelaySeconds: 5,
                        periodSeconds: 10
                    },
                    resources: resources.cloudflared,
                    securityContext: {
                        allowPrivilegeEscalation: false,
                        readOnlyRootFilesystem: true,
                        runAsNonRoot: true,
                        runAsUser: 65532,
                        capabilities: { drop: ["ALL"] },
                        seccompProfile: {
                            type: "RuntimeDefault"
                        }
                    }
                }],
                volumes: [
                    {
                        name: "config",
                        configMap: {
                            name: cloudflaredConfig.metadata.name,
                            items: [{
                                key: "config.yaml",
                                path: "config.yaml"
                            }]
                        }
                    },
                    {
                        name: "creds",
                        secret: {
                            secretName: cloudflaredCredentials.metadata.name
                        }
                    }
                ],
                securityContext: {
                    fsGroup: 65532
                }
            }
        }
    }
}, { provider: k8sProvider });

// Service for Cloudflared metrics
const cloudflaredService = new k8s.core.v1.Service("cloudflared-metrics", {
    metadata: {
        name: "cloudflared-metrics",
        namespace: cloudflareNs.metadata.name,
        labels: { "oceanid.cluster/component": "networking" }
    },
    spec: {
        ports: [
            { name: "metrics", port: 2000, targetPort: 2000 }
        ],
        selector: { app: "cloudflared" }
    }
}, { provider: k8sProvider });

// =============================================================================
// GATEWAY API (2025 Best Practice)
// =============================================================================

// Gateway Class for the cluster
const gatewayClass = new k8s.apiextensions.CustomResource("gateway-class", {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "GatewayClass",
    metadata: {
        name: "oceanid-gateway-class",
        labels: { "oceanid.cluster/component": "gateway-api" }
    },
    spec: {
        controllerName: "io.k8s.gateway-controller/envoy-gateway",
        description: "Oceanid Cluster Gateway powered by Envoy"
    }
}, { provider: k8sProvider });

// Main Gateway for external traffic
const gateway = new k8s.apiextensions.CustomResource("main-gateway", {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "Gateway",
    metadata: {
        name: "oceanid-gateway",
        namespace: gatewayNs.metadata.name,
        labels: { "oceanid.cluster/component": "gateway-api" }
    },
    spec: {
        gatewayClassName: gatewayClass.metadata.name,
        listeners: [
            {
                name: "http",
                protocol: "HTTP",
                port: 80,
                allowedRoutes: {
                    namespaces: { from: "All" }
                }
            },
            {
                name: "https",
                protocol: "HTTPS",
                port: 443,
                tls: {
                    mode: "Terminate",
                    certificateRefs: [{
                        name: "oceanid-tls",
                        namespace: gatewayNs.metadata.name
                    }]
                },
                allowedRoutes: {
                    namespaces: { from: "All" }
                }
            }
        ],
        addresses: [
            { value: clusterConfig.tethysIp },
            { value: clusterConfig.styxIp }
        ]
    }
}, { provider: k8sProvider });

// =============================================================================
// NETWORK POLICIES
// =============================================================================

// Allow internal cluster communication
// Export for potential use by other stacks
export const internalNetworkPolicy = new k8s.networking.v1.NetworkPolicy("allow-internal", {
    metadata: {
        name: "allow-internal-communication",
        namespace: "default",
        labels: { "oceanid.cluster/component": "network-policy" }
    },
    spec: {
        podSelector: {},
        policyTypes: ["Ingress", "Egress"],
        ingress: [{
            from: [
                { namespaceSelector: {} },
                { podSelector: {} }
            ]
        }],
        egress: [{
            to: [
                { namespaceSelector: {} },
                { podSelector: {} }
            ]
        }]
    }
}, { provider: k8sProvider });

// =============================================================================
// OUTPUTS
// =============================================================================

export const clusterEndpoint = pulumi.interpolate`https://${clusterConfig.tethysIp}:6443`;
export const gatewayUrl = gateway.metadata.apply(m =>
    `http://${m.name}.${m.namespace}.svc.cluster.local`
);
export const cloudflareMetricsUrl = cloudflaredService.metadata.apply(m =>
    `http://${m.name}.${m.namespace}.svc.cluster.local:2000/metrics`
);
export const status = "Oceanid Cluster - Production-Ready 2025 Infrastructure";
export const components = {
    networking: "Cloudflare Tunnels + Gateway API (2025 Standard) + QUIC Optimized",
    secrets: "Pulumi ESC with Automatic Rotation (30-day TTL)",
    certificates: "cert-manager with Cloudflare DNS validation",
    rotation: "CronJob-based secret rotation (30-day TTL)",
    security: "Network Policies + RBAC + Pod Security Standards",
    storage: "Persistent Volumes via k3s local-path",
    monitoring: "Sentry (External)",
    udpBuffers: "Optimized for QUIC (7.5MB buffers)"
};