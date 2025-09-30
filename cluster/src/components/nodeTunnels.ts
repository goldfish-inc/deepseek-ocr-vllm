import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";

import { ClusterConfig } from "../config";

export interface NodeTunnelsArgs {
    cluster: ClusterConfig;
    k8sProvider: k8s.Provider;
    cloudflareProvider?: cloudflare.Provider;
}

export interface NodeTunnelOutputs {
    namespace: pulumi.Output<string>;
    daemonSetName: pulumi.Output<string>;
    metricsServiceName: pulumi.Output<string>;
    dnsRecords: pulumi.Output<Record<string, string>>;
}

export class NodeTunnels extends pulumi.ComponentResource {
    public readonly outputs: NodeTunnelOutputs;

    constructor(name: string, args: NodeTunnelsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:networking:NodeTunnels", name, {}, opts);

        const { cluster, k8sProvider, cloudflareProvider } = args;
        const nodeTunnel = cluster.nodeTunnel;

        const namespace = new k8s.core.v1.Namespace(`${name}-ns`, {
            metadata: {
                name: "node-tunnels",
                labels: {
                    "app.kubernetes.io/name": "node-tunnels",
                    "app.kubernetes.io/part-of": cluster.name,
                    "oceanid.cluster/managed-by": "pulumi",
                    "oceanid.cluster/component": "networking",
                },
            },
        }, { provider: k8sProvider, parent: this });

        // Decode ESC token: supports base64-encoded credentials.json or raw TUNNEL_TOKEN
        const decodedToken = nodeTunnel.tunnelToken.apply(token => {
            const trimmed = token.trim();
            try {
                const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
                const reencoded = Buffer.from(decoded, "utf-8").toString("base64");
                if (reencoded.replace(/=+$/, "") === trimmed.replace(/=+$/, "")) {
                    return decoded;
                }
            } catch {
                // Fall back to raw token if base64 decoding fails
            }
            return trimmed;
        });

        const useCredentialsFile = decodedToken.apply(val => {
            try {
                const obj = JSON.parse(val);
                return !!(obj && obj.AccountTag && obj.TunnelSecret && obj.TunnelID);
            } catch {
                return false;
            }
        });

        const tunnelSecret = new k8s.core.v1.Secret(`${name}-credentials`, {
            metadata: {
                name: "tunnel-credentials",
                namespace: namespace.metadata.name,
            },
            stringData: pulumi.secret({
                // credentials.json expects decoded JSON; token must be the raw token string
                "credentials.json": decodedToken,
                "token": decodedToken,
            }),
        }, { provider: k8sProvider, parent: this });

        const metricsPort = nodeTunnel.metricsPort;

        const tunnelConfig = new k8s.core.v1.ConfigMap(`${name}-config`, {
            metadata: {
                name: "tunnel-config",
                namespace: namespace.metadata.name,
            },
            data: {
                "config.yaml": pulumi.all([useCredentialsFile]).apply(([useFile]) =>
`tunnel: ${nodeTunnel.tunnelId}
${useFile ? "credentials-file: /etc/cloudflared/creds/credentials.json\n" : ""}# Let cloudflared auto-negotiate (QUIC/HTTP2) for reliability across NATs
protocol: auto
no-autoupdate: true
metrics: 0.0.0.0:${metricsPort}

edge-ip-version: "4"

warp-routing:
  enabled: true

ingress:
  - hostname: "${nodeTunnel.hostnames.nodesWildcard}"
    service: https://kubernetes.default.svc.cluster.local:443
    originRequest:
      noTLSVerify: false
      caPool: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt

  - hostname: ${nodeTunnel.hostnames.gpu}
    service: http://localhost:8000
    originRequest:
      noTLSVerify: true

  - hostname: "${nodeTunnel.hostnames.podsWildcard}"
    service: tcp://localhost:10250
    originRequest:
      noTLSVerify: true

  - service: http_status:404
`),
            },
        }, { provider: k8sProvider, parent: this });

        const daemonSet = new k8s.apps.v1.DaemonSet(`${name}-daemonset`, {
            metadata: {
                name: "cloudflared-tunnel",
                namespace: namespace.metadata.name,
                labels: {
                    "app.kubernetes.io/name": "cloudflared-tunnel",
                    "app.kubernetes.io/part-of": cluster.name,
                },
            },
            spec: {
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "cloudflared-tunnel",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "cloudflared-tunnel",
                            "app.kubernetes.io/part-of": cluster.name,
                        },
                    },
                    spec: {
                        nodeSelector: {
                            "oceanid.cluster/tunnel-enabled": "true",
                        },
                        tolerations: [
                            {
                                key: "nvidia.com/gpu",
                                operator: "Equal",
                                value: "true",
                                effect: "NoSchedule",
                            },
                            {
                                key: "workload-type",
                                operator: "Equal",
                                value: "gpu-compute",
                                effect: "NoSchedule",
                            },
                        ],
                        hostNetwork: true,
                        // With hostNetwork true, use cluster DNS for service discovery
                        dnsPolicy: "ClusterFirstWithHostNet",
                        containers: [
                            {
                                name: "cloudflared",
                                image: nodeTunnel.image,
                                args: [
                                    "tunnel",
                                    "--config", "/etc/cloudflared/config/config.yaml",
                                    "--loglevel", "debug",
                                    "run",
                                ],
                                securityContext: {
                                    capabilities: {
                                        add: ["NET_ADMIN", "NET_RAW", "SYS_ADMIN"],
                                        drop: ["ALL"],
                                    },
                                    runAsNonRoot: false,
                                    runAsUser: 0,
                                    privileged: false,
                                },
                                env: pulumi.all([useCredentialsFile]).apply(([useFile]) => [
                                    { name: "NO_AUTOUPDATE", value: "true" },
                                    { name: "TUNNEL_TRANSPORT_PROTOCOL", value: "auto" },
                                    ...(!useFile ? [{
                                        name: "TUNNEL_TOKEN",
                                        valueFrom: { secretKeyRef: { name: tunnelSecret.metadata.name, key: "token" } },
                                    } as k8s.types.input.core.v1.EnvVar] : []),
                                ]),
                                ports: [
                                    {
                                        name: "metrics",
                                        containerPort: metricsPort,
                                    },
                                ],
                                resources: nodeTunnel.resources,
                                volumeMounts: pulumi.all([useCredentialsFile]).apply(([useFile]) => [
                                    { name: "config", mountPath: "/etc/cloudflared/config", readOnly: true },
                                    ...(
                                        useFile ? [{ name: "creds", mountPath: "/etc/cloudflared/creds", readOnly: true } as k8s.types.input.core.v1.VolumeMount] : []
                                    ),
                                ]),
                                livenessProbe: {
                                    httpGet: {
                                        path: "/ready",
                                        port: metricsPort,
                                    },
                                    initialDelaySeconds: 30,
                                    periodSeconds: 30,
                                },
                                readinessProbe: {
                                    httpGet: {
                                        path: "/ready",
                                        port: metricsPort,
                                    },
                                    initialDelaySeconds: 10,
                                    periodSeconds: 10,
                                },
                            },
                        ],
                        volumes: pulumi.all([useCredentialsFile]).apply(([useFile]) => [
                            { name: "config", configMap: { name: tunnelConfig.metadata.name } },
                            ...(
                                useFile ? [{ name: "creds", secret: { secretName: tunnelSecret.metadata.name } } as k8s.types.input.core.v1.Volume] : []
                            ),
                        ]),
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [namespace, tunnelSecret, tunnelConfig] });

        const metricsService = new k8s.core.v1.Service(`${name}-metrics`, {
            metadata: {
                name: "cloudflared-metrics",
                namespace: namespace.metadata.name,
                labels: {
                    "app.kubernetes.io/name": "cloudflared-tunnel",
                },
            },
            spec: {
                selector: {
                    "app.kubernetes.io/name": "cloudflared-tunnel",
                },
                ports: [
                    {
                        name: "metrics",
                        port: metricsPort,
                        targetPort: metricsPort,
                    },
                ],
            },
        }, { provider: k8sProvider, parent: this });

        const dnsRecords: Record<string, pulumi.Output<string>> = {};

        if (cloudflareProvider) {
            const gpuRecord = new cloudflare.DnsRecord(`${name}-gpu`, {
                zoneId: nodeTunnel.zoneId,
                name: nodeTunnel.hostnames.gpu,
                type: "CNAME",
                content: nodeTunnel.target,
                proxied: true,
                ttl: 1,
                comment: pulumi.interpolate`GPU access for ${cluster.name} node tunnel`,
            }, { provider: cloudflareProvider, parent: this });

            const nodesRecord = new cloudflare.DnsRecord(`${name}-nodes`, {
                zoneId: nodeTunnel.zoneId,
                name: nodeTunnel.hostnames.nodesWildcard,
                type: "CNAME",
                content: nodeTunnel.target,
                proxied: true,
                ttl: 1,
                comment: pulumi.interpolate`Node access wildcard for ${cluster.name} node tunnel`,
            }, { provider: cloudflareProvider, parent: this });

            const podsRecord = new cloudflare.DnsRecord(`${name}-pods`, {
                zoneId: nodeTunnel.zoneId,
                name: nodeTunnel.hostnames.podsWildcard,
                type: "CNAME",
                content: nodeTunnel.target,
                proxied: true,
                ttl: 1,
                comment: pulumi.interpolate`Pod access wildcard for ${cluster.name} node tunnel`,
            }, { provider: cloudflareProvider, parent: this });

            dnsRecords.gpu = gpuRecord.name;
            dnsRecords.nodes = nodesRecord.name;
            dnsRecords.pods = podsRecord.name;
        }

        this.outputs = {
            namespace: namespace.metadata.name,
            daemonSetName: daemonSet.metadata.name,
            metricsServiceName: metricsService.metadata.name,
            dnsRecords: pulumi.output(dnsRecords),
        };

        this.registerOutputs(this.outputs);
    }
}
