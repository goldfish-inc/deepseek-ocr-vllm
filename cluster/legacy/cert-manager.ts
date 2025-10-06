import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// =============================================================================
// CERT-MANAGER WITH CLOUDFLARE DNS VALIDATION (2025 BEST PRACTICE)
// =============================================================================

const config = new pulumi.Config();
const k8sProvider = new k8s.Provider("k8s-provider", {
    kubeconfig: pulumi.output(process.env.KUBECONFIG || "./kubeconfig.yaml")
});

// Cert-Manager namespace
const certManagerNs = new k8s.core.v1.Namespace("cert-manager", {
    metadata: {
        name: "cert-manager",
        labels: {
            "pod-security.kubernetes.io/enforce": "restricted",
            "oceanid.cluster/component": "cert-manager"
        }
    }
}, { provider: k8sProvider });

// Install cert-manager using Helm (production-ready)
const certManager = new k8s.helm.v3.Release("cert-manager", {
    name: "cert-manager",
    namespace: certManagerNs.metadata.name,
    chart: "cert-manager",
    repositoryOpts: {
        repo: "https://charts.jetstack.io"
    },
    version: "v1.15.0",  // Latest stable as of 2025
    values: {
        installCRDs: true,
        global: {
            leaderElection: {
                namespace: certManagerNs.metadata.name
            }
        },
        resources: {
            requests: {
                cpu: "100m",
                memory: "128Mi"
            },
            limits: {
                cpu: "200m",
                memory: "256Mi"
            }
        },
        prometheus: {
            enabled: true,
            servicemonitor: {
                enabled: true
            }
        },
        webhook: {
            timeoutSeconds: 30,
            resources: {
                requests: {
                    cpu: "50m",
                    memory: "64Mi"
                },
                limits: {
                    cpu: "100m",
                    memory: "128Mi"
                }
            }
        },
        cainjector: {
            resources: {
                requests: {
                    cpu: "50m",
                    memory: "64Mi"
                },
                limits: {
                    cpu: "100m",
                    memory: "128Mi"
                }
            }
        }
    }
}, { provider: k8sProvider });

// Cloudflare API token secret for cert-manager
const cloudflareApiSecret = new k8s.core.v1.Secret("cloudflare-api-token", {
    metadata: {
        name: "cloudflare-api-token",
        namespace: certManagerNs.metadata.name
    },
    stringData: {
        "api-token": config.requireSecret("cloudflare_api_token")
    }
}, { provider: k8sProvider, dependsOn: [certManager] });

// ClusterIssuer for Let's Encrypt with Cloudflare DNS validation
export const letsEncryptIssuer = new k8s.apiextensions.CustomResource("letsencrypt-prod", {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
        name: "letsencrypt-prod"
    },
    spec: {
        acme: {
            server: "https://acme-v02.api.letsencrypt.org/directory",
            email: "admin@goldfish.io",
            privateKeySecretRef: {
                name: "letsencrypt-prod-key"
            },
            solvers: [{
                dns01: {
                    cloudflare: {
                        apiTokenSecretRef: {
                            name: cloudflareApiSecret.metadata.name,
                            key: "api-token"
                        }
                    }
                }
            }]
        }
    }
}, { provider: k8sProvider, dependsOn: [certManager] });

// ClusterIssuer for Cloudflare Origin CA
export const cloudflareOriginIssuer = new k8s.apiextensions.CustomResource("cloudflare-origin", {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
        name: "cloudflare-origin"
    },
    spec: {
        acme: {
            server: "https://api.cloudflare.com/client/v4",
            email: "admin@goldfish.io",
            privateKeySecretRef: {
                name: "cloudflare-origin-key"
            },
            solvers: [{
                http01: {
                    ingress: {
                        class: "cloudflare-tunnel"
                    }
                }
            }]
        }
    }
}, { provider: k8sProvider, dependsOn: [certManager] });

// Wildcard certificate for the domain
export const wildcardCertificate = new k8s.apiextensions.CustomResource("wildcard-cert", {
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: {
        name: "goldfish-io-wildcard",
        namespace: "default"
    },
    spec: {
        secretName: "goldfish-io-tls",
        issuerRef: {
            name: letsEncryptIssuer.metadata.name,
            kind: "ClusterIssuer"
        },
        commonName: "goldfish.io",
        dnsNames: [
            "goldfish.io",
            "*.goldfish.io"
        ],
        duration: "8760h",  // 1 year
        renewBefore: "720h",  // Renew 30 days before expiry
        privateKey: {
            algorithm: "RSA",
            encoding: "PKCS1",
            size: 2048,
            rotationPolicy: "Always"  // Rotate private key on renewal
        },
        usages: [
            "digital signature",
            "key encipherment"
        ]
    }
}, { provider: k8sProvider, dependsOn: [letsEncryptIssuer] });

// Certificate for internal services
export const internalCertificate = new k8s.apiextensions.CustomResource("internal-cert", {
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: {
        name: "oceanid-internal",
        namespace: "default"
    },
    spec: {
        secretName: "oceanid-internal-tls",
        issuerRef: {
            name: cloudflareOriginIssuer.metadata.name,
            kind: "ClusterIssuer"
        },
        commonName: "*.oceanid.local",
        dnsNames: [
            "*.oceanid.local",
            "*.svc.cluster.local"
        ],
        duration: "8760h",
        renewBefore: "720h",
        privateKey: {
            algorithm: "ECDSA",
            size: 256,
            rotationPolicy: "Always"
        }
    }
}, { provider: k8sProvider, dependsOn: [cloudflareOriginIssuer] });

// Export cert-manager status
export const certManagerStatus = {
    namespace: certManagerNs.metadata.name,
    version: "v1.15.0",
    issuers: {
        letsEncrypt: letsEncryptIssuer.metadata.name,
        cloudflareOrigin: cloudflareOriginIssuer.metadata.name
    },
    certificates: {
        wildcard: wildcardCertificate.metadata.name,
        internal: internalCertificate.metadata.name
    },
    autoRenewal: "30 days before expiry",
    dnsValidation: "Cloudflare DNS-01"
};
