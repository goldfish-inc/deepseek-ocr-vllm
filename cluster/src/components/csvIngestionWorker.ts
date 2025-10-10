import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface CSVIngestionWorkerArgs {
    namespace: pulumi.Input<string>;
    dbUrl: pulumi.Input<string>;
    s3Bucket: pulumi.Input<string>;
    s3Region?: pulumi.Input<string>;
    labelStudioUrl: pulumi.Input<string>;
    reviewManagerUrl?: pulumi.Input<string>;
    // Prefer passing a full immutable image reference (e.g., ghcr.io/...:${GIT_SHA})
    image?: pulumi.Input<string>;
    imageTag?: pulumi.Input<string>;
    replicas?: pulumi.Input<number>;
}

export class CSVIngestionWorker extends pulumi.ComponentResource {
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;
    // ServiceMonitor disabled until Prometheus is installed
    // public readonly serviceMonitor: k8s.apiextensions.CustomResource;

    constructor(name: string, args: CSVIngestionWorkerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:apps:CSVIngestionWorker", name, {}, opts);

        const labels = { app: "csv-ingestion-worker", component: "data-pipeline" };
        const imageTag = args.imageTag || "main";
        const baseImage = "ghcr.io/goldfish-inc/oceanid/csv-ingestion-worker";
        const imageRef = args.image || pulumi.interpolate`${baseImage}:${imageTag}`;

        // ConfigMap for confidence thresholds
        const confidenceConfig = new k8s.core.v1.ConfigMap(`${name}-config`, {
            metadata: {
                namespace: args.namespace,
                labels,
            },
            data: {
                CONFIDENCE_CONFIG: JSON.stringify({
                    IMO: { base: 0.98, trusted_bonus: 0.02, untrusted_malus: -0.02 },
                    MMSI: { base: 0.98, trusted_bonus: 0.02, untrusted_malus: -0.02 },
                    IRCS: { base: 0.98, trusted_bonus: 0.02, untrusted_malus: -0.02 },
                    VESSEL_NAME: { base: 0.90, trusted_bonus: 0.02, untrusted_malus: -0.02 },
                    FLAG: { base: 0.95, trusted_bonus: 0.02, untrusted_malus: -0.02 },
                    DATE: { base: 0.95, trusted_bonus: 0.02, untrusted_malus: -0.02 },
                    NUMBER: { base: 0.95, trusted_bonus: 0.02, untrusted_malus: -0.02 },
                    DEFAULT: { base: 0.85, trusted_bonus: 0.02, untrusted_malus: -0.02 },
                }),
            },
        }, { parent: this });

        // Deployment
        this.deployment = new k8s.apps.v1.Deployment(`${name}-deployment`, {
            metadata: {
                namespace: args.namespace,
                labels,
                annotations: {
                    "pulumi.com/skipAwait": "false",
                },
            },
            spec: {
                replicas: args.replicas || 2,
                selector: { matchLabels: labels },
                strategy: {
                    type: "RollingUpdate",
                    rollingUpdate: {
                        maxSurge: 1,
                        maxUnavailable: 0,
                    },
                },
                template: {
                    metadata: {
                        labels,
                        annotations: {
                            "prometheus.io/scrape": "true",
                            "prometheus.io/port": "8080",
                            "prometheus.io/path": "/metrics",
                        },
                    },
                    spec: {
                        serviceAccountName: "default",
                        securityContext: {
                            runAsNonRoot: true,
                            runAsUser: 1000,
                            fsGroup: 1000,
                            seccompProfile: {
                                type: "RuntimeDefault",
                            },
                        },
                        containers: [{
                            name: "csv-worker",
                            image: imageRef,
                            imagePullPolicy: "Always",
                            ports: [{
                                name: "http",
                                containerPort: 8080,
                                protocol: "TCP",
                            }],
                            env: [
                                {
                                    name: "DATABASE_URL",
                                    value: args.dbUrl,
                                },
                                {
                                    name: "S3_BUCKET",
                                    value: args.s3Bucket,
                                },
                                {
                                    name: "S3_REGION",
                                    value: args.s3Region || "us-east-1",
                                },
                                {
                                    name: "LABEL_STUDIO_URL",
                                    value: args.labelStudioUrl,
                                },
                                {
                                    name: "REVIEW_MANAGER_URL",
                                    value: args.reviewManagerUrl || "http://review-queue-manager.apps:8080",
                                },
                                {
                                    name: "CONFIDENCE_CONFIG",
                                    valueFrom: {
                                        configMapKeyRef: {
                                            name: confidenceConfig.metadata.name,
                                            key: "CONFIDENCE_CONFIG",
                                        },
                                    },
                                },
                                {
                                    name: "MAX_WORKERS",
                                    value: "10",
                                },
                                {
                                    name: "PORT",
                                    value: "8080",
                                },
                            ],
                            resources: {
                                requests: {
                                    memory: "128Mi",
                                    cpu: "100m",
                                },
                                limits: {
                                    memory: "512Mi",
                                    cpu: "500m",
                                },
                            },
                            livenessProbe: {
                                httpGet: {
                                    path: "/health",
                                    port: "http",
                                },
                                initialDelaySeconds: 10,
                                periodSeconds: 30,
                                timeoutSeconds: 3,
                                successThreshold: 1,
                                failureThreshold: 3,
                            },
                            readinessProbe: {
                                httpGet: {
                                    path: "/health",
                                    port: "http",
                                },
                                initialDelaySeconds: 5,
                                periodSeconds: 10,
                                timeoutSeconds: 3,
                                successThreshold: 1,
                                failureThreshold: 3,
                            },
                            securityContext: {
                                allowPrivilegeEscalation: false,
                                readOnlyRootFilesystem: true,
                                runAsNonRoot: true,
                                runAsUser: 1000,
                                capabilities: {
                                    drop: ["ALL"],
                                },
                            },
                        }],
                        imagePullSecrets: [{
                            name: "ghcr-creds",
                        }],
                        affinity: {
                            podAntiAffinity: {
                                preferredDuringSchedulingIgnoredDuringExecution: [{
                                    weight: 100,
                                    podAffinityTerm: {
                                        labelSelector: {
                                            matchExpressions: [{
                                                key: "app",
                                                operator: "In",
                                                values: ["csv-ingestion-worker"],
                                            }],
                                        },
                                        topologyKey: "kubernetes.io/hostname",
                                    },
                                }],
                            },
                        },
                    },
                },
            },
        }, { parent: this, deleteBeforeReplace: true });

        // Service
        this.service = new k8s.core.v1.Service(`${name}-service`, {
            metadata: {
                namespace: args.namespace,
                labels,
                annotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "8080",
                },
            },
            spec: {
                type: "ClusterIP",
                selector: labels,
                ports: [{
                    name: "http",
                    port: 8080,
                    targetPort: "http",
                    protocol: "TCP",
                }],
            },
        }, { parent: this });

        // ServiceMonitor for Prometheus - disabled until Prometheus is installed
        // this.serviceMonitor = new k8s.apiextensions.CustomResource(`${name}-servicemonitor`, {
        //     apiVersion: "monitoring.coreos.com/v1",
        //     kind: "ServiceMonitor",
        //     metadata: {
        //         namespace: args.namespace,
        //         labels: {
        //             ...labels,
        //             "prometheus": "kube-prometheus",
        //         },
        //     },
        //     spec: {
        //         selector: {
        //             matchLabels: labels,
        //         },
        //         endpoints: [{
        //             port: "http",
        //             interval: "30s",
        //             path: "/metrics",
        //         }],
        //     },
        // }, { parent: this });

        // Register outputs
        this.registerOutputs({
            deploymentName: this.deployment.metadata.name,
            serviceName: this.service.metadata.name,
            serviceUrl: pulumi.interpolate`http://${this.service.metadata.name}.${args.namespace}:8080`,
        });
    }
}

// Factory function for easier instantiation
export function createCSVIngestionWorker(
    name: string,
    args: CSVIngestionWorkerArgs,
    opts?: pulumi.ComponentResourceOptions
): CSVIngestionWorker {
    return new CSVIngestionWorker(name, args, opts);
}
