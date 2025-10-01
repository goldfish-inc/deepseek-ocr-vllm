import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface LabelStudioArgs {
    k8sProvider: k8s.Provider;
    namespace?: string;
    replicas?: number;
    mlBackendUrl?: pulumi.Input<string>;
    dbUrl?: pulumi.Input<string>;           // Optional: external Postgres (CrunchyBridge)
    hostUrl?: pulumi.Input<string>;         // Optional: public URL (e.g., https://label.<base>)
}

export class LabelStudio extends pulumi.ComponentResource {
    public readonly namespace: pulumi.Output<string>;
    public readonly serviceName: pulumi.Output<string>;

    constructor(name: string, args: LabelStudioArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:apps:LabelStudio", name, {}, opts);

        const { k8sProvider, namespace = "apps", replicas = 1, mlBackendUrl, dbUrl, hostUrl } = args;

        const ns = new k8s.core.v1.Namespace(`${name}-ns`, {
            metadata: {
                name: namespace,
                labels: {
                    "oceanid.cluster/managed-by": "pulumi",
                    "oceanid.cluster/component": "apps",
                },
            },
        }, { provider: k8sProvider, parent: this });

        const labels = { app: "label-studio" };

        const cfg = new pulumi.Config();
        const adminEmail = cfg.get("labelStudioAdminEmail") || cfg.get("labelStudioEmail") || cfg.get("labelStudioUsername");
        const adminPassword = cfg.getSecret("labelStudioAdminPassword") || cfg.getSecret("labelStudioPassword");

        // S3 storage credentials from ESC
        const awsAccessKeyId = cfg.getSecret("aws.labelStudio.accessKeyId");
        const awsSecretAccessKey = cfg.getSecret("aws.labelStudio.secretAccessKey");
        const awsBucketName = cfg.get("aws.labelStudio.bucketName");
        const awsRegion = cfg.get("aws.labelStudio.region") || "us-east-1";

        // Create Kubernetes secret for S3 credentials
        const s3Secret = new k8s.core.v1.Secret(`${name}-s3-secret`, {
            metadata: { name: "labelstudio-s3-credentials", namespace },
            stringData: {
                AWS_ACCESS_KEY_ID: awsAccessKeyId as any,
                AWS_SECRET_ACCESS_KEY: awsSecretAccessKey as any,
                AWS_STORAGE_BUCKET_NAME: awsBucketName || "",
                AWS_S3_REGION_NAME: awsRegion,
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [ns] });

        const deploy = new k8s.apps.v1.Deployment(`${name}-deploy`, {
            metadata: { name: "label-studio", namespace },
            spec: {
                replicas,
                selector: { matchLabels: labels },
                template: {
                    metadata: { labels },
                    spec: {
                        containers: [
                            {
                                name: "label-studio",
                                image: "heartexlabs/label-studio:1.21.0",
                                ports: [{ containerPort: 8080, name: "http" }],
                                env: [
                                    { name: "LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED", value: "true" },
                                    { name: "CSRF_TRUSTED_ORIGINS", value: "https://label.boathou.se" },
                                    { name: "DJANGO_ALLOWED_HOSTS", value: "*" },
                                    ...(mlBackendUrl ? [{ name: "LABEL_STUDIO_ML_BACKEND_URL", value: mlBackendUrl }] : []),
                                    ...(dbUrl ? [{ name: "DATABASE_URL", value: dbUrl as any }] : []),
                                    ...(hostUrl ? [{ name: "LABEL_STUDIO_HOST", value: hostUrl as any }] : []),
                                    ...(adminEmail ? [{ name: "LABEL_STUDIO_USERNAME", value: adminEmail as any }] : []),
                                    ...(adminPassword ? [{ name: "LABEL_STUDIO_PASSWORD", value: adminPassword as any }] : []),
                                    // S3 storage configuration
                                    { name: "USE_BLOB_URLS", value: "true" },
                                    { name: "AWS_ACCESS_KEY_ID", valueFrom: { secretKeyRef: { name: "labelstudio-s3-credentials", key: "AWS_ACCESS_KEY_ID" } } },
                                    { name: "AWS_SECRET_ACCESS_KEY", valueFrom: { secretKeyRef: { name: "labelstudio-s3-credentials", key: "AWS_SECRET_ACCESS_KEY" } } },
                                    { name: "AWS_STORAGE_BUCKET_NAME", valueFrom: { secretKeyRef: { name: "labelstudio-s3-credentials", key: "AWS_STORAGE_BUCKET_NAME" } } },
                                    { name: "AWS_S3_REGION_NAME", valueFrom: { secretKeyRef: { name: "labelstudio-s3-credentials", key: "AWS_S3_REGION_NAME" } } },
                                ] as any,
                                resources: {
                                    requests: { cpu: "100m", memory: "256Mi" },
                                    limits: { cpu: "500m", memory: "512Mi" },
                                },
                            },
                        ],
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [ns, s3Secret] });

        const svc = new k8s.core.v1.Service(`${name}-svc`, {
            metadata: { name: "label-studio", namespace },
            spec: {
                selector: labels,
                ports: [{ port: 8080, targetPort: "http", name: "http" }],
            },
        }, { provider: k8sProvider, parent: this });

        this.namespace = ns.metadata.name;
        this.serviceName = svc.metadata.name;
        this.registerOutputs({ namespace: this.namespace, serviceName: this.serviceName });
    }
}
