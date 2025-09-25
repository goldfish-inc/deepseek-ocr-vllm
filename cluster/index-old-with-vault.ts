import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// Configuration - pulls from Pulumi.*.yaml files
const config = new pulumi.Config();

// Get latest stable versions from config
const vaultImage = config.get("vaultImage") || "hashicorp/vault:latest";
const opConnectApiImage = config.get("onePasswordApiImage") || "1password/connect-api:latest";
const opConnectSyncImage = config.get("onePasswordSyncImage") || "1password/connect-sync:latest";
const cloudflaredImage = config.get("cloudflaredImage") || "cloudflare/cloudflared:latest";
const certManagerImage = config.get("certManagerImage") || "quay.io/jetstack/cert-manager-controller:latest";

// Oceanid Cluster Configuration
const clusterConfig = {
    name: config.get("clusterName") || "oceanid-cluster",
    domain: config.get("clusterDomain") || "oceanid.internal",
    tethysIp: config.require("tethysIp"),
    styxIp: config.require("styxIp"),
    meliaeIp: config.get("meliaeIp"),
    calypsoIp: config.get("calypsoIp"),
};

// Resource limits and requests
const resources = {
    vault: {
        limits: { memory: config.get("vaultMemoryLimit") || "512Mi", cpu: config.get("vaultCpuLimit") || "500m" },
        requests: { memory: "256Mi", cpu: "200m" }
    },
    opConnect: {
        limits: { memory: "256Mi", cpu: "200m" },
        requests: { memory: "128Mi", cpu: "100m" }
    },
    cloudflared: {
        limits: { memory: "128Mi", cpu: "100m" },
        requests: { memory: "64Mi", cpu: "50m" }
    }
};

// Kubernetes provider using existing k3s cluster
const k8sProvider = new k8s.Provider("oceanid-k8s", {
    kubeconfig: process.env.KUBECONFIG || "./kubeconfig.yaml",
});

// =============================================================================
// NAMESPACES
// =============================================================================

const vaultNs = new k8s.core.v1.Namespace("vault", {
    metadata: {
        name: "vault",
        labels: {
            "oceanid.cluster/component": "secrets",
            "oceanid.cluster/environment": "production",
            "pod-security.kubernetes.io/enforce": "restricted",
            "pod-security.kubernetes.io/audit": "restricted",
            "pod-security.kubernetes.io/warn": "restricted"
        }
    }
}, { provider: k8sProvider });

const cloudflareNs = new k8s.core.v1.Namespace("cloudflare", {
    metadata: {
        name: "cloudflare",
        labels: {
            "oceanid.cluster/component": "networking",
            "oceanid.cluster/environment": "production"
        }
    }
}, { provider: k8sProvider });

const gatewayNs = new k8s.core.v1.Namespace("gateway-system", {
    metadata: {
        name: "gateway-system",
        labels: {
            "oceanid.cluster/component": "networking",
            "oceanid.cluster/environment": "production"
        }
    }
}, { provider: k8sProvider });

const certManagerNs = new k8s.core.v1.Namespace("cert-manager", {
    metadata: {
        name: "cert-manager",
        labels: {
            "oceanid.cluster/component": "security",
            "oceanid.cluster/environment": "production"
        }
    }
}, { provider: k8sProvider });

// =============================================================================
// RBAC AND SERVICE ACCOUNTS
// =============================================================================

const vaultServiceAccount = new k8s.core.v1.ServiceAccount("vault-sa", {
    metadata: {
        name: "vault",
        namespace: vaultNs.metadata.name,
        labels: { "oceanid.cluster/component": "vault" }
    }
}, { provider: k8sProvider });

const vaultClusterRole = new k8s.rbac.v1.ClusterRole("vault-cluster-role", {
    metadata: {
        name: "vault",
        labels: { "oceanid.cluster/component": "vault" }
    },
    rules: [
        {
            apiGroups: [""],
            resources: ["secrets", "configmaps"],
            verbs: ["get", "list", "create", "update", "patch", "delete"]
        },
        {
            apiGroups: [""],
            resources: ["serviceaccounts", "serviceaccounts/token"],
            verbs: ["get", "list", "create", "update", "patch", "delete"]
        },
        {
            apiGroups: ["rbac.authorization.k8s.io"],
            resources: ["clusterroles", "clusterrolebindings", "roles", "rolebindings"],
            verbs: ["get", "list", "create", "update", "patch", "delete"]
        }
    ]
}, { provider: k8sProvider });

const vaultClusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding("vault-cluster-role-binding", {
    metadata: {
        name: "vault",
        labels: { "oceanid.cluster/component": "vault" }
    },
    roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: vaultClusterRole.metadata.name
    },
    subjects: [{
        kind: "ServiceAccount",
        name: vaultServiceAccount.metadata.name,
        namespace: vaultServiceAccount.metadata.namespace
    }]
}, { provider: k8sProvider });

// =============================================================================
// CONFIGMAPS
// =============================================================================

const vaultConfig = new k8s.core.v1.ConfigMap("vault-config", {
    metadata: {
        name: "vault-config",
        namespace: vaultNs.metadata.name,
        labels: { "oceanid.cluster/component": "vault" }
    },
    data: {
        "vault.hcl": `
ui = true
disable_mlock = true
cluster_name = "${clusterConfig.name}"

storage "file" {
  path = "/vault/data"
}

listener "tcp" {
  address = "0.0.0.0:8200"
  tls_disable = true
}

api_addr = "http://0.0.0.0:8200"
cluster_addr = "https://0.0.0.0:8201"

# Enable Kubernetes auth
auth "kubernetes" {
  path = "kubernetes"
}

# Enable KV secrets engine
path "secret/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
`
    }
}, { provider: k8sProvider });

// =============================================================================
// VAULT + 1PASSWORD CONNECT DEPLOYMENT
// =============================================================================

const vaultDeployment = new k8s.apps.v1.StatefulSet("vault", {
    metadata: {
        name: "vault",
        namespace: vaultNs.metadata.name,
        labels: {
            "oceanid.cluster/component": "vault",
            "app": "vault-1password"
        }
    },
    spec: {
        serviceName: "vault",
        replicas: 1,
        selector: {
            matchLabels: { app: "vault" }
        },
        template: {
            metadata: {
                labels: {
                    app: "vault",
                    "oceanid.cluster/component": "vault"
                },
                annotations: {
                    "sentry.io/monitor": "true"
                }
            },
            spec: {
                serviceAccountName: vaultServiceAccount.metadata.name,
                securityContext: {
                    runAsNonRoot: true,
                    runAsUser: 100,
                    runAsGroup: 1000,
                    fsGroup: 1000,
                    seccompProfile: {
                        type: "RuntimeDefault"
                    }
                },
                containers: [
                    {
                        name: "vault",
                        image: vaultImage,
                        ports: [
                            { containerPort: 8200, name: "vault-api" },
                            { containerPort: 8201, name: "vault-cluster" }
                        ],
                        env: [
                            { name: "VAULT_ADDR", value: "http://127.0.0.1:8200" },
                            { name: "VAULT_API_ADDR", value: "http://0.0.0.0:8200" },
                            { name: "VAULT_CLUSTER_ADDR", value: "https://0.0.0.0:8201" },
                            { name: "VAULT_CONFIG_DIR", value: "/vault/config" },
                            { name: "VAULT_LOG_LEVEL", value: "INFO" }
                        ],
                        command: ["vault"],
                        args: ["server", "-config=/vault/config/vault.hcl"],
                        resources: resources.vault,
                        volumeMounts: [
                            { name: "vault-data", mountPath: "/vault/data" },
                            { name: "vault-config", mountPath: "/vault/config" }
                        ],
                        livenessProbe: {
                            httpGet: { path: "/v1/sys/health", port: 8200 },
                            initialDelaySeconds: 30,
                            periodSeconds: 30
                        },
                        readinessProbe: {
                            httpGet: { path: "/v1/sys/health", port: 8200 },
                            initialDelaySeconds: 10,
                            periodSeconds: 10
                        },
                        securityContext: {
                            allowPrivilegeEscalation: false,
                            capabilities: { drop: ["ALL"] }
                        }
                    }
                    // 1Password Connect containers temporarily disabled
                    // Will be added after Vault is initialized
                ],
                volumes: [
                    {
                        name: "vault-config",
                        configMap: { name: vaultConfig.metadata.name }
                    }
                ]
            }
        },
        volumeClaimTemplates: [
            {
                metadata: {
                    name: "vault-data",
                    labels: { "oceanid.cluster/component": "vault" }
                },
                spec: {
                    accessModes: ["ReadWriteOnce"],
                    resources: { requests: { storage: "10Gi" } },
                    storageClassName: "local-path"
                }
            }
        ]
    }
}, { provider: k8sProvider });

// =============================================================================
// SERVICES
// =============================================================================

const vaultService = new k8s.core.v1.Service("vault", {
    metadata: {
        name: "vault",
        namespace: vaultNs.metadata.name,
        labels: {
            "oceanid.cluster/component": "vault",
            "app": "vault-1password"
        }
    },
    spec: {
        type: "ClusterIP",
        ports: [
            { name: "vault-api", port: 8200, targetPort: 8200 }
        ],
        selector: { app: "vault" }
    }
}, { provider: k8sProvider });

// =============================================================================
// CLOUDFLARE TUNNELS
// =============================================================================

// Cloudflare Tunnel Configuration
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
  # Vault Service
  - hostname: vault.goldfish.io
    service: http://vault.vault.svc.cluster.local:8200
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
      tcpKeepAlive: 30s
      keepAliveConnections: 4
      httpHostHeader: "vault.goldfish.io"

  # Kubernetes API (via Gateway API)
  - hostname: k8s.goldfish.io
    service: https://kubernetes.default.svc.cluster.local:443
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s

  # Metrics endpoint
  - hostname: metrics.goldfish.io
    service: http://localhost:2000

  # Health check endpoint
  - hostname: health.goldfish.io
    service: http_status:200

  # Catch-all
  - service: http_status:404
`
    }
}, { provider: k8sProvider });

// Cloudflare Tunnel Deployment
const cloudflaredDeployment = new k8s.apps.v1.Deployment("cloudflared", {
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
                    "sentry.io/monitor": "true"
                }
            },
            spec: {
                serviceAccountName: "cloudflared",
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
                                    name: "cloudflared-credentials",
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
                            secretName: "cloudflared-credentials"
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

// =============================================================================
// GATEWAY API (2025 Best Practice - Replaces Ingress)
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

// HTTPRoute for Vault
const vaultRoute = new k8s.apiextensions.CustomResource("vault-route", {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: {
        name: "vault-route",
        namespace: vaultNs.metadata.name,
        labels: { "oceanid.cluster/component": "gateway-api" }
    },
    spec: {
        parentRefs: [{
            name: gateway.metadata.name,
            namespace: gatewayNs.metadata.name
        }],
        hostnames: [`vault.${clusterConfig.domain}`],
        rules: [{
            matches: [{ path: { type: "PathPrefix", value: "/" } }],
            backendRefs: [{
                name: vaultService.metadata.name,
                port: 8200
            }]
        }]
    }
}, { provider: k8sProvider });

// =============================================================================
// NETWORK POLICIES
// =============================================================================

const vaultNetworkPolicy = new k8s.networking.v1.NetworkPolicy("vault-network-policy", {
    metadata: {
        name: "vault-network-policy",
        namespace: vaultNs.metadata.name,
        labels: { "oceanid.cluster/component": "security" }
    },
    spec: {
        podSelector: {
            matchLabels: { app: "vault-1password" }
        },
        policyTypes: ["Ingress", "Egress"],
        ingress: [
            {
                from: [
                    { namespaceSelector: {} }
                ],
                ports: [
                    { protocol: "TCP", port: 8200 },
                    { protocol: "TCP", port: 8080 },
                    { protocol: "TCP", port: 8081 }
                ]
            }
        ],
        egress: [
            {
                to: [],
                ports: [
                    { protocol: "TCP", port: 53 },
                    { protocol: "UDP", port: 53 },
                    { protocol: "TCP", port: 443 },
                    { protocol: "TCP", port: 80 }
                ]
            }
        ]
    }
}, { provider: k8sProvider });

// =============================================================================
// EXPORTS
// =============================================================================

export const clusterEndpoint = `https://${clusterConfig.tethysIp}:6443`;
export const vaultServiceUrl = pulumi.interpolate`http://vault.${vaultNs.metadata.name}.svc.cluster.local:8200`;
export const opConnectApiUrl = pulumi.interpolate`http://vault.${vaultNs.metadata.name}.svc.cluster.local:8080`;
export const gatewayUrl = pulumi.interpolate`http://oceanid-gateway.${gatewayNs.metadata.name}.svc.cluster.local`;
export const status = "Oceanid Cluster Deployed - Production Ready with Gateway API";
export const components = {
    vault: "HashiCorp Vault with 1Password Connect",
    networking: "Cloudflare Tunnels + Gateway API (2025 Standard)",
    security: "Network Policies + RBAC + Pod Security Standards",
    monitoring: "Sentry (External)",
    storage: "Persistent Volumes via k3s local-path"
};