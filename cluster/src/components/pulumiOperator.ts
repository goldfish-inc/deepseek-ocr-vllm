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

        // Create OCI HelmRepository for PKO
        const helmRepo = new k8s.apiextensions.CustomResource(`${name}-helm-repo`, {
            apiVersion: "source.toolkit.fluxcd.io/v1beta2",
            kind: "HelmRepository",
            metadata: {
                name: "pulumi",
                namespace: namespaceName,
            },
            spec: {
                interval: "10m",
                type: "oci",
                url: "oci://ghcr.io/pulumi/helm-charts",
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [namespace] });

        // Deploy PKO via Helm
        const helmRelease = new k8s.apiextensions.CustomResource(`${name}-helm-release`, {
            apiVersion: "helm.toolkit.fluxcd.io/v2beta1",
            kind: "HelmRelease",
            metadata: {
                name: "pulumi-kubernetes-operator",
                namespace: namespaceName,
            },
            spec: {
                interval: "10m",
                chart: {
                    spec: {
                        chart: "pulumi-kubernetes-operator",
                        version: "2.2.0",
                        sourceRef: {
                            kind: "HelmRepository",
                            name: "pulumi",
                            namespace: namespaceName,
                        },
                    },
                },
                values: {
                    // PKO v2 requires cluster-wide installation
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
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [helmRepo] });

        this.namespace = pulumi.output(namespaceName);
        this.secretName = secret.metadata.name;

        this.registerOutputs({
            namespace: this.namespace,
            secretName: this.secretName,
        });
    }
}