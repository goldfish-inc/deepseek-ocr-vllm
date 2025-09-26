import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";

// =============================================================================
// CLOUDFLARE TUNNEL CONFIGURATION FOR K3S API
// =============================================================================

const config = new pulumi.Config();

// Get Cloudflare configuration from ESC
const tunnelToken = config.requireSecret("cloudflare_tunnel_token");
const tunnelId = config.require("cloudflare_tunnel_id");
const accountId = config.require("cloudflare_account_id");
const zoneId = config.require("cloudflare_zone_id");

// =============================================================================
// DNS RECORDS
// =============================================================================

// Create DNS record for k3s API access through tunnel
export const k3sApiDns = new cloudflare.Record("k3s-api-dns", {
    zoneId: zoneId,
    name: "tethys",
    type: "CNAME",
    value: `${tunnelId}.cfargotunnel.com`,
    proxied: true,
    comment: "k3s API endpoint via Cloudflare tunnel",
});

// =============================================================================
// TUNNEL CONFIGURATION
// =============================================================================

// Configure the tunnel with ingress rules
export const tunnelConfig = new cloudflare.TunnelConfig("oceanid-tunnel-config", {
    accountId: accountId,
    tunnelId: tunnelId,
    config: {
        originRequest: {
            connectTimeout: "30s",
            noTLSVerify: true,  // k3s uses self-signed certs
            keepAliveTimeout: "30s",
            httpHostHeader: "tethys.boathou.se",
        },
        ingress: [
            {
                hostname: "tethys.boathou.se",
                service: "https://157.173.210.123:6443",
                path: undefined,
                originRequest: {
                    noTLSVerify: true,
                    connectTimeout: "30s",
                    // Allow k3s websocket connections
                    httpHostHeader: "tethys.boathou.se",
                    originServerName: "tethys.boathou.se",
                }
            },
            // Add other services
            {
                hostname: "vault.boathou.se",
                service: "http://vault.vault.svc.cluster.local:8200",
            },
            {
                hostname: "dashboard.boathou.se",
                service: "http://kubernetes-dashboard.kubernetes-dashboard.svc.cluster.local",
            },
            // Catch-all rule (required)
            {
                service: "http_status:404",
            }
        ],
    },
});

// =============================================================================
// KUBERNETES RESOURCES FOR TUNNEL
// =============================================================================

const k8sProvider = new k8s.Provider("k8s-provider", {
    kubeconfig: pulumi.output(process.env.KUBECONFIG || "./kubeconfig.yaml")
});

// Update the cloudflared deployment configuration
export const cloudflaredConfigMap = new k8s.core.v1.ConfigMap("cloudflared-config", {
    metadata: {
        name: "cloudflared-config",
        namespace: "cloudflare",
    },
    data: {
        "config.yaml": pulumi.interpolate`
tunnel: ${tunnelId}
credentials-file: /etc/cloudflared/creds/credentials.json
protocol: quic
loglevel: info
transport-loglevel: warn

# Ingress rules managed by Cloudflare API above
# This config just establishes the tunnel connection
no-autoupdate: true
metrics: 0.0.0.0:2000

# Performance optimizations for k3s API
originRequest:
  connectTimeout: 30s
  tlsTimeout: 30s
  noTLSVerify: true
  keepAliveConnections: 10
  keepAliveTimeout: 30s
  httpHostHeader: tethys.boathou.se
`,
    }
}, { provider: k8sProvider });

// Service to expose metrics
export const cloudflaredService = new k8s.core.v1.Service("cloudflared-metrics", {
    metadata: {
        name: "cloudflared-metrics",
        namespace: "cloudflare",
        labels: {
            app: "cloudflared",
        }
    },
    spec: {
        selector: {
            app: "cloudflared",
        },
        ports: [{
            name: "metrics",
            port: 2000,
            targetPort: 2000,
        }],
    }
}, { provider: k8sProvider });

// =============================================================================
// NETWORK POLICIES
// =============================================================================

// Restrict access to k3s API
export const k3sApiNetworkPolicy = new k8s.networking.v1.NetworkPolicy("k3s-api-policy", {
    metadata: {
        name: "k3s-api-access",
        namespace: "default",
    },
    spec: {
        podSelector: {},
        policyTypes: ["Ingress"],
        ingress: [{
            from: [
                {
                    namespaceSelector: {
                        matchLabels: {
                            name: "cloudflare",
                        }
                    }
                },
                {
                    // Allow internal cluster access
                    podSelector: {},
                }
            ],
            ports: [{
                protocol: "TCP",
                port: 6443,
            }]
        }]
    }
}, { provider: k8sProvider });

// =============================================================================
// OUTPUTS
// =============================================================================

export const tunnelStatus = {
    tunnelId: tunnelId,
    apiEndpoint: pulumi.interpolate`https://tethys.boathou.se:6443`,
    dnsRecord: k3sApiDns.hostname,
    tunnelConfigured: true,
};

export const securityStatus = {
    networkPoliciesEnabled: true,
    tlsVerification: false, // Disabled for self-signed certs
    publicApiExposed: false, // Only through tunnel
};