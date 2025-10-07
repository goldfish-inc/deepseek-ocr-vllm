import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { LabelStudioNetworkPolicy } from "./labelStudioNetworkPolicy";

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

        // PostgreSQL configuration from ESC
        const postgresConfig = cfg.getObject<{
            host: string;
            port: number;
            database: string;
            user: string;
            password: string;
        }>("postgres");

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

        // Create Kubernetes secret for database credentials (security best practice)
        const dbSecret = dbUrl ? new k8s.core.v1.Secret(`${name}-db-secret`, {
            metadata: { name: "labelstudio-db-credentials", namespace },
            stringData: {
                DATABASE_URL: dbUrl as any,
                // Extract password from URL for POSTGRE_PASSWORD env var
                POSTGRE_PASSWORD: pulumi.output(dbUrl).apply(url => {
                    const urlStr = url || "";
                    const match = urlStr.match(/:\/\/[^:]+:([^@]+)@/);
                    return match && match[1] ? decodeURIComponent(match[1]) : "";
                }),
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [ns] }) : undefined;

        // Persistent volume for Label Studio data directory
        const pvc = new k8s.core.v1.PersistentVolumeClaim(`${name}-pvc`, {
            metadata: { name: "label-studio-data", namespace },
            spec: {
                accessModes: ["ReadWriteOnce"],
                resources: {
                    requests: { storage: "10Gi" },
                },
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
                        volumes: [
                            {
                                name: "data",
                                persistentVolumeClaim: { claimName: "label-studio-data" },
                            },
                        ],
                        containers: [
                            {
                                name: "label-studio",
                                image: "heartexlabs/label-studio:1.21.0",
                                ports: [{ containerPort: 8080, name: "http" }],
                                volumeMounts: [
                                    {
                                        name: "data",
                                        mountPath: "/label-studio/data",
                                    },
                                ],
                                env: [
                                    { name: "LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED", value: "true" },
                                    // Security: Derive CSRF_TRUSTED_ORIGINS from hostUrl dynamically
                                    ...(hostUrl ? [{ name: "CSRF_TRUSTED_ORIGINS", value: hostUrl }] : []),
                                    // Security: Restrict DJANGO_ALLOWED_HOSTS to actual hostname instead of wildcard
                                    ...(hostUrl ? [{
                                        name: "DJANGO_ALLOWED_HOSTS",
                                        value: pulumi.interpolate`${hostUrl}`.apply(url => new URL(url).hostname)
                                    }] : [{ name: "DJANGO_ALLOWED_HOSTS", value: "*" }]),
                                    // PDF rendering support (hybrid: pdf.js preview + page images for boxes)
                                    { name: "LABEL_STUDIO_PDF_RENDERER", value: "pdf.js" },
                                    { name: "PDF_CONVERT_TO_IMAGES", value: "true" },
                                    // File upload support: CSV, TSV, JSON, XLSX, TXT
                                    { name: "LABEL_STUDIO_FILE_UPLOAD_TYPES", value: "csv,tsv,json,jsonl,xlsx,txt" },
                                    // PostgreSQL configuration via Kubernetes Secret (security best practice)
                                    // Label Studio requires POSTGRE_* vars OR properly formatted DATABASES env
                                    ...(dbUrl ? [
                                        { name: "DJANGO_DB", value: "default" },
                                        { name: "POSTGRE_NAME", value: "labelfish" },
                                        { name: "POSTGRE_USER", value: "labelfish_owner" },
                                        { name: "POSTGRE_PASSWORD", valueFrom: { secretKeyRef: { name: "labelstudio-db-credentials", key: "POSTGRE_PASSWORD" } } },
                                        { name: "POSTGRE_PORT", value: "5432" },
                                        { name: "POSTGRE_HOST", value: "p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com" },
                                    ] : []),
                                    ...(mlBackendUrl ? [{ name: "LABEL_STUDIO_ML_BACKEND_URL", value: mlBackendUrl }] : []),
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
                                // Health probes: Allow LS to retry DB connection without initContainer
                                startupProbe: {
                                    httpGet: { path: "/", port: 8080 as any },
                                    initialDelaySeconds: 10,
                                    periodSeconds: 5,
                                    failureThreshold: 30,  // Allow 150s for DB connection + migrations
                                },
                                readinessProbe: {
                                    httpGet: { path: "/", port: 8080 as any },
                                    periodSeconds: 10,
                                    failureThreshold: 3,
                                },
                                livenessProbe: {
                                    httpGet: { path: "/", port: 8080 as any },
                                    periodSeconds: 30,
                                    failureThreshold: 3,
                                },
                            },
                        ],
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: dbSecret ? [ns, s3Secret, dbSecret, pvc] : [ns, s3Secret, pvc] });

        const svc = new k8s.core.v1.Service(`${name}-svc`, {
            metadata: { name: "label-studio", namespace },
            spec: {
                selector: labels,
                ports: [{ port: 8080, targetPort: "http", name: "http" }],
            },
        }, { provider: k8sProvider, parent: this });

        // Network policy for egress restrictions (security hardening)
        const networkPolicy = postgresConfig ? new LabelStudioNetworkPolicy(`${name}-netpol`, {
            k8sProvider,
            namespace,
            crunchyBridgeHost: postgresConfig.host,
        }, { parent: this }) : undefined;

        this.namespace = ns.metadata.name;
        this.serviceName = svc.metadata.name;
        this.registerOutputs({ namespace: this.namespace, serviceName: this.serviceName });
    }
}
