import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ClusterConfig } from "../config";

export interface PulumiOperatorArgs {
    cluster: ClusterConfig;
    k8sProvider: k8s.Provider;
}

export class PulumiOperator extends pulumi.ComponentResource {
    public readonly namespace: pulumi.Output<string>;
    public readonly secretName: pulumi.Output<string>;

    constructor(name: string, args: PulumiOperatorArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:pko:PulumiOperator", name, {}, opts);

        const { cluster, k8sProvider } = args;
        const namespaceName = "pulumi-system";

        // Create namespace
        const namespace = new k8s.core.v1.Namespace(`${name}-ns`, {
            metadata: {
                name: namespaceName,
            },
        }, { provider: k8sProvider, parent: this });

        // Get Pulumi access token from config (managed by ESC)
        const cfg = new pulumi.Config();
        const pulumiConfig = cfg.getObject("pulumi") as any;

        console.log("PKO: Checking for Pulumi token in config...");
        console.log("PKO: pulumiConfig exists?", !!pulumiConfig);

        const pulumiToken = pulumiConfig?.access_token ?
            pulumi.secret(pulumiConfig.access_token) :
            cfg.requireSecret("pulumi_access_token");

        // Create secret for PKO
        const secret = new k8s.core.v1.Secret(`${name}-api-secret`, {
            metadata: {
                name: "pulumi-api-secret",
                namespace: namespaceName,
                labels: {
                    "app.kubernetes.io/managed-by": "pulumi",
                    "app.kubernetes.io/part-of": "pko",
                },
            },
            type: "Opaque",
            stringData: {
                accessToken: pulumiToken,
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [namespace] });

        // Deploy PKO via standard Helm (NOT through Flux which isn't installed yet)
        // Allow overriding PKO chart version via Pulumi config key `pkoChartVersion`.
        const cfgVersion = new pulumi.Config();
        const pkoChartVersion = cfgVersion.get("pkoChartVersion") || "2.2.0";

        const helmRelease = new k8s.helm.v3.Release(`${name}-helm`, {
            name: "pulumi-kubernetes-operator",
            namespace: namespaceName,
            chart: "oci://ghcr.io/pulumi/helm-charts/pulumi-kubernetes-operator",
            version: pkoChartVersion,
            values: {
                // PKO v2 requires cluster-wide installation
                // Install CRDs since we're not using Flux
                installCRDs: true,
                controllerManager: {
                    replicas: 1,
                    resources: {
                        requests: {
                            cpu: "100m",
                            memory: "128Mi",
                        },
                        limits: {
                            cpu: "500m",
                            memory: "512Mi",
                        },
                    },
                    // Avoid scheduling on GPU nodes
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
                },
                // For PKO v2 workspace pods
                workspaceTemplate: {
                    resources: {
                        requests: {
                            cpu: "50m",
                            memory: "64Mi",
                        },
                        limits: {
                            cpu: "1000m",
                            memory: "1Gi",
                        },
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [namespace, secret] });

        this.namespace = pulumi.output(namespaceName);
        this.secretName = secret.metadata.name;

        this.registerOutputs({
            namespace: this.namespace,
            secretName: this.secretName,
        });
    }
}
