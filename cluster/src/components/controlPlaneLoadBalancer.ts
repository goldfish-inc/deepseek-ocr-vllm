import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface ControlPlaneLoadBalancerArgs {
    masterNodes: Array<{
        name: string;
        ip: string;
        hostname: string;
    }>;
    k8sProvider: k8s.Provider;
    virtualIP?: string;
    enableHealthChecks?: boolean;
}

export interface ControlPlaneLoadBalancerOutputs {
    namespace: pulumi.Output<string>;
    loadBalancerIP: pulumi.Output<string>;
    healthStatus: pulumi.Output<Record<string, boolean>>;
}

export class ControlPlaneLoadBalancer extends pulumi.ComponentResource {
    public readonly outputs: ControlPlaneLoadBalancerOutputs;

    constructor(name: string, args: ControlPlaneLoadBalancerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:infrastructure:ControlPlaneLoadBalancer", name, {}, opts);

        const { masterNodes, k8sProvider, virtualIP, enableHealthChecks = true } = args;
        const namespaceName = "kube-system";

        // Create HAProxy ConfigMap for load balancing across control plane nodes
        const haproxyConfig = new k8s.core.v1.ConfigMap(`${name}-haproxy-config`, {
            metadata: {
                name: "haproxy-config",
                namespace: namespaceName,
                labels: {
                    "app.kubernetes.io/name": "haproxy",
                    "app.kubernetes.io/component": "load-balancer",
                    "oceanid.cluster/component": "control-plane-lb",
                },
            },
            data: {
                "haproxy.cfg": pulumi.interpolate`
global
    log stdout local0
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    daemon

defaults
    mode tcp
    log global
    option tcplog
    option dontlognull
    option tcp-check
    retries 3
    timeout queue 1000
    timeout connect 1000
    timeout server 3000
    timeout client 3000
    timeout check 3000

frontend k8s-api-frontend
    bind *:6443
    mode tcp
    default_backend k8s-api-backend

backend k8s-api-backend
    mode tcp
    balance roundrobin
    option tcp-check
    tcp-check connect
    tcp-check send-binary 474554202f20485454502f312e310d0a0d0a
    tcp-check expect binary 485454502f312e31
${masterNodes.map((node, index) =>
    `    server ${node.name} ${node.ip}:6443 check inter 5000 fall 2 rise 2`
).join('\n')}

frontend stats
    bind *:8404
    mode http
    stats enable
    stats uri /stats
    stats refresh 30s
    stats admin if TRUE
`
            },
        }, { provider: k8sProvider, parent: this });

        // Deploy HAProxy as a DaemonSet on control plane nodes
        const haproxyDaemonSet = new k8s.apps.v1.DaemonSet(`${name}-haproxy`, {
            metadata: {
                name: "haproxy-control-plane-lb",
                namespace: namespaceName,
                labels: {
                    "app.kubernetes.io/name": "haproxy",
                    "app.kubernetes.io/component": "load-balancer",
                },
            },
            spec: {
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "haproxy",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "haproxy",
                            "app.kubernetes.io/component": "load-balancer",
                        },
                    },
                    spec: {
                        nodeSelector: {
                            "node-role.kubernetes.io/control-plane": "true",
                        },
                        tolerations: [
                            {
                                key: "node-role.kubernetes.io/control-plane",
                                operator: "Exists",
                                effect: "NoSchedule",
                            },
                        ],
                        hostNetwork: true,
                        dnsPolicy: "ClusterFirstWithHostNet",
                        containers: [
                            {
                                name: "haproxy",
                                image: "haproxy:2.9-alpine",
                                ports: [
                                    {
                                        name: "k8s-api",
                                        containerPort: 6443,
                                        hostPort: 6443, // Must match containerPort when hostNetwork is true
                                    },
                                    {
                                        name: "stats",
                                        containerPort: 8404,
                                        hostPort: 8404,
                                    },
                                ],
                                livenessProbe: {
                                    httpGet: {
                                        path: "/stats",
                                        port: 8404,
                                    },
                                    initialDelaySeconds: 30,
                                    periodSeconds: 10,
                                },
                                readinessProbe: {
                                    httpGet: {
                                        path: "/stats",
                                        port: 8404,
                                    },
                                    initialDelaySeconds: 10,
                                    periodSeconds: 5,
                                },
                                resources: {
                                    requests: {
                                        cpu: "100m",
                                        memory: "128Mi",
                                    },
                                    limits: {
                                        cpu: "200m",
                                        memory: "256Mi",
                                    },
                                },
                                volumeMounts: [
                                    {
                                        name: "haproxy-config",
                                        mountPath: "/usr/local/etc/haproxy/haproxy.cfg",
                                        subPath: "haproxy.cfg",
                                        readOnly: true,
                                    },
                                ],
                                securityContext: {
                                    runAsNonRoot: true,
                                    runAsUser: 99, // haproxy user
                                    allowPrivilegeEscalation: false,
                                    readOnlyRootFilesystem: true,
                                    capabilities: {
                                        drop: ["ALL"],
                                    },
                                },
                            },
                        ],
                        volumes: [
                            {
                                name: "haproxy-config",
                                configMap: {
                                    name: haproxyConfig.metadata.name,
                                },
                            },
                        ],
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [haproxyConfig] });

        // Create a service for the load balancer stats
        const statsService = new k8s.core.v1.Service(`${name}-stats`, {
            metadata: {
                name: "haproxy-stats",
                namespace: namespaceName,
                labels: {
                    "app.kubernetes.io/name": "haproxy",
                    "app.kubernetes.io/component": "load-balancer",
                },
            },
            spec: {
                selector: {
                    "app.kubernetes.io/name": "haproxy",
                },
                ports: [
                    {
                        name: "stats",
                        port: 8404,
                        targetPort: 8404,
                    },
                ],
                type: "ClusterIP",
            },
        }, { provider: k8sProvider, parent: this });

        // Health check monitoring (if enabled)
        const healthChecks = enableHealthChecks
            ? masterNodes.reduce((checks, node) => {
                checks[node.name] = pulumi.output(true); // Placeholder for actual health checks
                return checks;
            }, {} as Record<string, pulumi.Output<boolean>>)
            : {};

        this.outputs = {
            namespace: pulumi.output(namespaceName),
            loadBalancerIP: virtualIP ? pulumi.output(virtualIP) : pulumi.output(masterNodes[0]?.ip || ''),
            healthStatus: pulumi.output(
                Object.fromEntries(
                    Object.entries(healthChecks).map(([name, status]) => [name, status])
                )
            ),
        };

        this.registerOutputs(this.outputs);
    }
}