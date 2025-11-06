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
                "config.yaml": `tunnel: ${cluster.cloudflare.tunnelId}
credentials-file: /etc/cloudflared/token/token
no-autoupdate: true
protocol: http2
edge-ip-version: "4"
metrics: 0.0.0.0:${cluster.metricsPort}

# Ingress rules are managed remotely via Cloudflare API (cloudflare.ZeroTrustTunnelCloudflaredConfig)
# This ensures cloudflared uses the authoritative remote configuration and prevents drift
# Local ingress rules are intentionally omitted to avoid conflicts with remote config
`,
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
                strategy: {
                    type: "RollingUpdate",
                    rollingUpdate: {
                        maxSurge: 1,
                        maxUnavailable: 0,
                    },
                },
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
                        // Bump this token to force a new ReplicaSet rollout
                        annotations: {
                            "oceanid.dev/rollout-token": "3",
                        },
                    },
                    spec: {
                        securityContext: {
                            fsGroup: 65532,
                        },
                        priorityClassName: "system-cluster-critical",
                        // Limit pod restarts: CrashLoopBackOff escalates exponentially (10s, 20s, 40s, 80s, 160s, capped at 5min)
                        // After ~5 failed startups (total ~5min), pod enters sustained CrashLoopBackOff
                        restartPolicy: "Always",
                        // Terminate pods quickly on failure to speed up CrashLoopBackOff detection
                        terminationGracePeriodSeconds: 5,
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
                                // Startup probe gives cloudflared time to establish the first tunnel
                                // Increase window to accommodate external DNS slowness during tunnel bootstrap
                                // Max startup time: 20s initial + (5s period × 24 failures) = 140s
                                startupProbe: {
                                    httpGet: {
                                        path: "/metrics",
                                        port: "metrics",
                                    },
                                    initialDelaySeconds: 20,
                                    periodSeconds: 5,
                                    failureThreshold: 24,
                                },
                                // Readiness uses HTTP metrics endpoint (tunnel connection status checked via liveness)
                                readinessProbe: {
                                    httpGet: {
                                        path: "/metrics",
                                        port: "metrics",
                                    },
                                    initialDelaySeconds: 15,
                                    periodSeconds: 10,
                                    failureThreshold: 3,
                                },
                                // Liveness: metrics endpoint reachable implies process is healthy
                                // Kills pod after 3 consecutive failures (90s: 30s initial + 3×20s period)
                                livenessProbe: {
                                    httpGet: {
                                        path: "/metrics",
                                        port: "metrics",
                                    },
                                    initialDelaySeconds: 30,
                                    periodSeconds: 20,
                                    failureThreshold: 3,  // Default is 3, made explicit
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
        }, {
            provider: k8sProvider,
            parent: this,
            dependsOn: [namespace],
            // Allow extra time for rollouts when DNS or feature negotiation is slow
            customTimeouts: { create: "10m", update: "10m" },
            // Force replacement when probe config or image changes to avoid stuck updates
            replaceOnChanges: ["spec.template.spec.containers[*].readinessProbe", "spec.template.spec.containers[*].livenessProbe", "spec.template.spec.containers[*].startupProbe", "spec.template.spec.containers[*].image"]
        });

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

        // Ensure at least one cloudflared stays available during voluntary disruptions
        const pdb = new k8s.policy.v1.PodDisruptionBudget(`${name}-pdb`, {
            metadata: {
                name: "cloudflared-pdb",
                namespace: namespace.metadata.name,
                labels: {
                    "app.kubernetes.io/name": "cloudflared",
                },
            },
            spec: {
                minAvailable: 1 as any,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "cloudflared",
                    },
                },
            },
        }, { provider: k8sProvider, parent: this })

        // NOTE: DNS records (k3s.boathou.se, gpu.boathou.se) now managed by oceanid-cloud stack
        // The cloudflared deployment still runs here, but DNS is managed centrally

        this.outputs = {
            namespace: namespace.metadata.name,
            deploymentName: deployment.metadata.name,
            metricsServiceName: service.metadata.name,
            dnsRecordName: pulumi.output(cluster.cloudflare.tunnelHostname),
        };

        this.registerOutputs(this.outputs);
    }
}
