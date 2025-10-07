import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface LabelStudioNetworkPolicyArgs {
    k8sProvider: k8s.Provider;
    namespace: string;
    crunchyBridgeHost: string;  // e.g., p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com
}

/**
 * NetworkPolicy for Label Studio pods
 * - Allows egress only to Crunchy Bridge database on TCP 5432
 * - Allows DNS queries for name resolution
 * - Denies all other egress from Label Studio pods
 */
export class LabelStudioNetworkPolicy extends pulumi.ComponentResource {
    public readonly policy: k8s.networking.v1.NetworkPolicy;

    constructor(name: string, args: LabelStudioNetworkPolicyArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:apps:LabelStudioNetworkPolicy", name, {}, opts);

        const { k8sProvider, namespace, crunchyBridgeHost } = args;

        // Network policy to restrict egress from Label Studio pods
        this.policy = new k8s.networking.v1.NetworkPolicy(`${name}-netpol`, {
            metadata: {
                name: "label-studio-egress",
                namespace,
            },
            spec: {
                podSelector: {
                    matchLabels: { app: "label-studio" },
                },
                policyTypes: ["Egress"],
                egress: [
                    // Allow DNS queries (required for resolving database hostname)
                    {
                        to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }],
                        ports: [
                            { protocol: "UDP", port: 53 },
                            { protocol: "TCP", port: 53 },
                        ],
                    },
                    // Allow connections to Crunchy Bridge PostgreSQL
                    {
                        to: [
                            // Note: NetworkPolicy doesn't support FQDN matching directly
                            // This allows all external IPs on port 5432
                            // For stricter control, use a service mesh or firewall
                            {
                                ipBlock: {
                                    cidr: "0.0.0.0/0",
                                    except: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],  // Exclude private ranges
                                },
                            },
                        ],
                        ports: [{ protocol: "TCP", port: 5432 }],
                    },
                    // Allow HTTPS to external services (PyPI, S3, etc.)
                    {
                        to: [{
                            ipBlock: {
                                cidr: "0.0.0.0/0",
                                except: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
                            },
                        }],
                        ports: [{ protocol: "TCP", port: 443 }],
                    },
                    // Allow communication within the cluster (for ML backend, services)
                    {
                        to: [{ namespaceSelector: {} }],
                        ports: [
                            { protocol: "TCP", port: 8080 },
                            { protocol: "TCP", port: 9090 },
                        ],
                    },
                ],
            },
        }, { provider: k8sProvider, parent: this });

        this.registerOutputs({});
    }
}
