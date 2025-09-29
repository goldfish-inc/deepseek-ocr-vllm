import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";

import { ClusterConfig } from "../config";

export interface CloudflareTunnelArgs {
    cluster: ClusterConfig;
    k8sProvider: k8s.Provider;
    cloudflareProvider: cloudflare.Provider;
    extraIngress?: Array<{
        hostname: pulumi.Input<string>;
        service: pulumi.Input<string>;
        noTLSVerify?: pulumi.Input<boolean>;
    }>;
    extraDns?: pulumi.Input<string>[];
}

export interface CloudflareTunnelOutputs {
    namespace: pulumi.Output<string>;
    deploymentName: pulumi.Output<string>;
    metricsServiceName: pulumi.Output<string>;
    dnsRecordName: pulumi.Output<string>;
}

export class CloudflareTunnel extends pulumi.ComponentResource {
    public readonly outputs: CloudflareTunnelOutputs;

    constructor(name: string, args: CloudflareTunnelArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:core:CloudflareTunnel", name, {}, opts);

        const { cluster, k8sProvider, cloudflareProvider, extraIngress = [], extraDns = [] } = args;
        const namespaceName = "cloudflared";

        const namespace = new k8s.core.v1.Namespace(`${name}-ns`, {
            metadata: {
                name: namespaceName,
                labels: {
                    "app.kubernetes.io/name": "cloudflared",
                    "app.kubernetes.io/part-of": cluster.name,
                    "pod-security.kubernetes.io/enforce": "baseline",
                    "oceanid.cluster/managed-by": "pulumi",
                    "oceanid.cluster/component": "networking",
                },
            },
        }, { provider: k8sProvider, parent: this });

        const credentials = new k8s.core.v1.Secret(`${name}-credentials`, {
            metadata: {
                name: "cloudflared-credentials",
                namespace: namespace.metadata.name,
            },
            stringData: pulumi.secret({
                token: cluster.cloudflare.tunnelToken,
            }),
        }, { provider: k8sProvider, parent: this });

        const configMap = new k8s.core.v1.ConfigMap(`${name}-config`, {
            metadata: {
                name: "cloudflared-config",
                namespace: namespace.metadata.name,
            },
            data: {
                "config.yaml": pulumi.output(extraIngress).apply((rules) => {
                    const extras = rules.map(r => `  - hostname: ${r.hostname}
    service: ${r.service}
    originRequest:\n      noTLSVerify: ${r.noTLSVerify ? "true" : "false"}\n`).join("");
                    return `tunnel: ${cluster.cloudflare.tunnelId}
credentials-file: /etc/cloudflared/token/token
no-autoupdate: true
metrics: 0.0.0.0:${cluster.metricsPort}
ingress:
  - hostname: ${cluster.cloudflare.tunnelHostname}
    service: ${cluster.cloudflare.tunnelServiceUrl}
    originRequest:
      noTLSVerify: false
      caPool: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
${extras}  - service: http_status:404
` as string;
                }),
            },
        }, { provider: k8sProvider, parent: this });

        const deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
            metadata: {
                name: "cloudflared",
                namespace: namespace.metadata.name,
                labels: {
                    "app.kubernetes.io/name": "cloudflared",
                    "app.kubernetes.io/part-of": cluster.name,
                },
            },
            spec: {
                replicas: 2,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "cloudflared",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "cloudflared",
                            "app.kubernetes.io/part-of": cluster.name,
                        },
                    },
                    spec: {
                        securityContext: {
                            fsGroup: 65532,
                        },
                        priorityClassName: "system-cluster-critical",
                        affinity: {
                            nodeAffinity: {
                                requiredDuringSchedulingIgnoredDuringExecution: {
                                    nodeSelectorTerms: [{
                                        matchExpressions: [{
                                            key: "workload-type",
                                            operator: "NotIn",
                                            values: ["gpu-compute"],
                                        }],
                                    }],
                                },
                            },
                        },
                        containers: [
                            {
                                name: "cloudflared",
                                image: cluster.cloudflare.image,
                                args: ["tunnel", "--config", "/etc/cloudflared/config/config.yaml", "run"],
                                env: [
                                    {
                                        name: "TUNNEL_TOKEN",
                                        valueFrom: {
                                            secretKeyRef: {
                                                name: credentials.metadata.name,
                                                key: "token",
                                            },
                                        },
                                    },
                                ],
                                ports: [
                                    {
                                        name: "metrics",
                                        containerPort: cluster.metricsPort,
                                    },
                                ],
                                readinessProbe: {
                                    httpGet: {
                                        path: "/ready",
                                        port: "metrics",
                                    },
                                    initialDelaySeconds: 5,
                                    periodSeconds: 10,
                                },
                                livenessProbe: {
                                    httpGet: {
                                        path: "/ready",
                                        port: "metrics",
                                    },
                                    initialDelaySeconds: 15,
                                    periodSeconds: 20,
                                },
                                resources: cluster.cloudflare.tunnelResources,
                                securityContext: {
                                    runAsNonRoot: true,
                                    runAsUser: 65532,
                                    allowPrivilegeEscalation: false,
                                    readOnlyRootFilesystem: true,
                                    capabilities: {
                                        drop: ["ALL"],
                                    },
                                },
                                volumeMounts: [
                                    {
                                        name: "config",
                                        mountPath: "/etc/cloudflared/config",
                                    },
                                    {
                                        name: "token",
                                        mountPath: "/etc/cloudflared/token",
                                        readOnly: true,
                                    },
                                ],
                            },
                        ],
                        volumes: [
                            {
                                name: "config",
                                configMap: {
                                    name: configMap.metadata.name,
                                },
                            },
                            {
                                name: "token",
                                secret: {
                                    secretName: credentials.metadata.name,
                                },
                            },
                        ],
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [namespace] });

        const service = new k8s.core.v1.Service(`${name}-svc`, {
            metadata: {
                name: "cloudflared-metrics",
                namespace: namespace.metadata.name,
                labels: {
                    "app.kubernetes.io/name": "cloudflared",
                },
            },
            spec: {
                selector: deployment.spec.apply(spec => spec.selector.matchLabels),
                ports: [
                    {
                        name: "metrics",
                        port: cluster.metricsPort,
                        targetPort: "metrics",
                    },
                ],
            },
        }, { provider: k8sProvider, parent: this });

        const dnsRecord = new cloudflare.DnsRecord(`${name}-record`, {
            zoneId: cluster.cloudflare.zoneId,
            name: cluster.cloudflare.tunnelHostname,
            type: "CNAME",
            content: cluster.cloudflare.tunnelTarget,
            proxied: true,
            ttl: 1,
            comment: pulumi.interpolate`Managed by Pulumi for cluster ${cluster.name}`,
        }, { provider: cloudflareProvider, parent: this });

        // Optional extra DNS hostnames
        extraDns.forEach((host, idx) => {
            new cloudflare.DnsRecord(`${name}-extra-${idx}`, {
                zoneId: cluster.cloudflare.zoneId,
                name: host,
                type: "CNAME",
                content: cluster.cloudflare.tunnelTarget,
                proxied: true,
                ttl: 1,
                comment: pulumi.interpolate`Extra hostname for ${cluster.name}`,
            }, { provider: cloudflareProvider, parent: this });
        });

        this.outputs = {
            namespace: namespace.metadata.name,
            deploymentName: deployment.metadata.name,
            metricsServiceName: service.metadata.name,
            dnsRecordName: dnsRecord.name,
        };

        this.registerOutputs(this.outputs);
    }
}
