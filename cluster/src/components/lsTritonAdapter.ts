import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { toEnvVars, getSentrySettings } from "../sentry-config";

export interface LsTritonAdapterArgs {
    k8sProvider: k8s.Provider;
    namespace?: string;
    serviceName?: string;
    tritonBaseUrl: pulumi.Input<string>; // e.g., https://gpu.boathou.se
    cfAccessClientId?: pulumi.Input<string>;
    cfAccessClientSecret?: pulumi.Input<string>;
    // Prefer passing a full immutable image reference (e.g., ghcr.io/...:${GIT_SHA})
    image?: pulumi.Input<string>;
    imageTag?: pulumi.Input<string>;
}

export class LsTritonAdapter extends pulumi.ComponentResource {
    public readonly serviceUrl: pulumi.Output<string>;
    public readonly serviceName: pulumi.Output<string>;

    constructor(name: string, args: LsTritonAdapterArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:ml:LsTritonAdapter", name, {}, opts);

        const { k8sProvider, namespace = "apps", serviceName = "ls-triton-adapter", tritonBaseUrl, cfAccessClientId, cfAccessClientSecret, image, imageTag } = args;

        // Use existing namespace rather than creating a new one
        // The 'apps' namespace is created by LabelStudio component
        const nsName = pulumi.output(namespace);

        const sentry = getSentrySettings();
        const cfgPulumi = new pulumi.Config();
        const hfToken = cfgPulumi.getSecret("hfAccessToken");
        const hfDatasetRepo = cfgPulumi.get("hfDatasetRepo") || "goldfish-inc/oceanid-annotations";
        const hfModelRepo = cfgPulumi.get("hfModelRepo") || "goldfish-inc/oceanid-ner-distilbert";
        const hfDatasetRepoNER = cfgPulumi.get("hfDatasetRepoNER") || "";
        const defaultLabels = [
            "O","VESSEL","HS_CODE","PORT","COMMODITY","IMO","FLAG","RISK_LEVEL","DATE"
        ];
        const nerLabelsFromConfig = cfgPulumi.getSecret("nerLabels");

        // Docling integration configuration
        const webhookSecret = cfgPulumi.getSecret("webhookSecret");
        const tritonDoclingEnabled = cfgPulumi.get("tritonDoclingEnabled") || "false";

        // Prefer K8s Secret for NER_LABELS sourced from ESC; fallback to config/default env
        let nerLabelsSecret: k8s.core.v1.Secret | undefined;
        if (nerLabelsFromConfig) {
            nerLabelsSecret = new k8s.core.v1.Secret(`${name}-ner-labels`, {
                metadata: { name: `${serviceName}-ner-labels`, namespace },
                stringData: {
                    "ner-labels": nerLabelsFromConfig,
                },
            }, { provider: k8sProvider, parent: this });
        }

        // Training configuration
        // Prefer immutable training worker image from ESC config
        const trainingWorkerImage = cfgPulumi.get("trainingWorkerImage");
        const trainingWorkerImageTag = cfgPulumi.get("trainingWorkerImageTag") || "main";
        const baseTrainingWorkerImage = "ghcr.io/goldfish-inc/oceanid/training-worker";
        const trainingWorkerImageRef = trainingWorkerImage || pulumi.interpolate`${baseTrainingWorkerImage}:${trainingWorkerImageTag}`;

        const envBase = {
            TRITON_BASE_URL: tritonBaseUrl,
            DOCUMENT_EXTRACTION_URL: "http://document-extraction.apps.svc.cluster.local:8080",
            DEFAULT_MODEL: "distilbert-base-uncased",
            TRITON_MODEL_NAME: cfgPulumi.get("tritonModelName") ?? "ner-distilbert",
            // Training controls (can be overridden via Pulumi config)
            TRAIN_ASYNC: cfgPulumi.get("trainAsync") ?? "true",
            TRAIN_DRY_RUN: cfgPulumi.get("trainDryRun") ?? "false",
            TRAINING_JOB_IMAGE: trainingWorkerImageRef as any,
            TRAINING_JOB_NAMESPACE: namespace,
            TRAINING_JOB_TTL_SECONDS: cfgPulumi.get("trainingJobTtlSeconds") ?? "3600",
            TRAIN_NODE_SELECTOR: cfgPulumi.get("trainingNodeSelector") ?? "kubernetes.io/hostname=calypso",
            TRAIN_GPU_RESOURCE: cfgPulumi.get("trainingGpuResource") ?? "nvidia.com/gpu",
            TRAIN_GPU_COUNT: cfgPulumi.get("trainingGpuCount") ?? "1",
            HF_DATASET_REPO: hfDatasetRepo,
            HF_MODEL_REPO: hfModelRepo,
            HF_DATASET_REPO_NER: (hfDatasetRepoNER || hfDatasetRepo) as any,
            TRAIN_HF_SECRET_NAME: "hf-credentials",
            TRAIN_HF_SECRET_KEY: "token",
            // Docling integration
            CSV_WORKER_WEBHOOK_URL: "http://csv-ingestion-worker.apps.svc.cluster.local:8080/webhook",
            TRITON_DOCLING_ENABLED: tritonDoclingEnabled,
            ...toEnvVars(sentry),
        } as Record<string, pulumi.Input<string>>;

        // Create K8s Secret for HF token sourced from ESC, so adapter‑spawned Jobs can reference it via SecretKeyRef
        if (hfToken) {
            new k8s.core.v1.Secret(`${name}-hf-credentials`, {
                metadata: { name: "hf-credentials", namespace },
                stringData: { token: hfToken as any },
            }, { provider: k8sProvider, parent: this });
        }

        // Optional: allow gating gpu.<base> behind Cloudflare Access with service tokens
        const cfIdFromCfg = cfgPulumi.getSecret("cfAccessClientId");
        const cfSecretFromCfg = cfgPulumi.getSecret("cfAccessClientSecret");
        const finalCfId = (cfAccessClientId as any) || (cfIdFromCfg as any);
        const finalCfSecret = (cfAccessClientSecret as any) || (cfSecretFromCfg as any);
        if (finalCfId && finalCfSecret) {
            envBase["CF_ACCESS_CLIENT_ID"] = finalCfId;
            envBase["CF_ACCESS_CLIENT_SECRET"] = finalCfSecret;
        }

        // Build container env vars
        const envVars: k8s.types.input.core.v1.EnvVar[] = Object.entries(envBase).map(([name, value]) => ({ name, value } as any));
        if (nerLabelsSecret) {
            // Use Secret value for NER_LABELS when provided
            envVars.push({
                name: "NER_LABELS",
                valueFrom: { secretKeyRef: { name: (nerLabelsSecret as any).metadata.name, key: "ner-labels" } },
            } as any);
        } else {
            // Fallback to config/default labels when Secret not provided
            envVars.push({ name: "NER_LABELS", value: (cfgPulumi.get("nerLabels") || JSON.stringify(defaultLabels)) } as any);
        }

        // Add S3 credentials from existing labelstudio-s3-credentials secret
        envVars.push({
            name: "AWS_ACCESS_KEY_ID",
            valueFrom: { secretKeyRef: { name: "labelstudio-s3-credentials", key: "AWS_ACCESS_KEY_ID" } },
        } as any);
        envVars.push({
            name: "AWS_SECRET_ACCESS_KEY",
            valueFrom: { secretKeyRef: { name: "labelstudio-s3-credentials", key: "AWS_SECRET_ACCESS_KEY" } },
        } as any);
        envVars.push({
            name: "AWS_REGION",
            valueFrom: { secretKeyRef: { name: "labelstudio-s3-credentials", key: "AWS_S3_REGION_NAME" } },
        } as any);
        envVars.push({
            name: "S3_BUCKET",
            valueFrom: { secretKeyRef: { name: "labelstudio-s3-credentials", key: "AWS_STORAGE_BUCKET_NAME" } },
        } as any);

        // Add webhook secret from ESC if configured
        if (webhookSecret) {
            envVars.push({ name: "WEBHOOK_SECRET", value: webhookSecret as any });
        }

        // ServiceAccount and RBAC to allow Job creation
        const sa = new k8s.core.v1.ServiceAccount(`${name}-sa`, {
            metadata: { name: serviceName, namespace },
        }, { provider: k8sProvider, parent: this });

        const role = new k8s.rbac.v1.Role(`${name}-role`, {
            metadata: { name: `${serviceName}-job-writer`, namespace },
            rules: [
                { apiGroups: ["batch"], resources: ["jobs"], verbs: ["create", "get", "list", "watch"] },
            ],
        }, { provider: k8sProvider, parent: this });

        new k8s.rbac.v1.RoleBinding(`${name}-rb`, {
            metadata: { name: `${serviceName}-job-writer`, namespace },
            roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: role.metadata.name },
            subjects: [{ kind: "ServiceAccount", name: sa.metadata.name, namespace }],
        }, { provider: k8sProvider, parent: this });

        // Prefer a full immutable image ref (e.g., ghcr.io/...:${GIT_SHA})
        const adapterImage = cfgPulumi.get("adapterImage");
        const adapterImageTag = cfgPulumi.get("adapterImageTag") || "main";
        const baseAdapterImage = "ghcr.io/goldfish-inc/oceanid/ls-triton-adapter";
        const adapterImageRef = adapterImage || pulumi.interpolate`${baseAdapterImage}:${adapterImageTag}`;

        const deploy = new k8s.apps.v1.Deployment(`${name}-deploy`, {
            metadata: { name: serviceName, namespace },
            spec: {
                replicas: 1,
                selector: { matchLabels: { app: serviceName } },
                template: {
                    metadata: { labels: { app: serviceName } },
                    spec: {
                        serviceAccountName: sa.metadata.name,
                        imagePullSecrets: [{ name: "ghcr-creds" }],
                        containers: [{
                            name: "adapter",
                            image: adapterImageRef as any,
                            env: envVars as any,
                            ports: [{ containerPort: 9090, name: "http" }],
                            readinessProbe: { httpGet: { path: "/health", port: 9090 }, initialDelaySeconds: 5, periodSeconds: 10 },
                            livenessProbe: { httpGet: { path: "/health", port: 9090 }, initialDelaySeconds: 10, periodSeconds: 20 },
                            resources: { requests: { cpu: "10m", memory: "16Mi" }, limits: { cpu: "100m", memory: "80Mi" } },
                        }],
                    },
                },
            },
        }, { provider: k8sProvider, parent: this });

        const svc = new k8s.core.v1.Service(`${name}-svc`, {
            metadata: { name: serviceName, namespace },
            spec: {
                selector: { app: serviceName },
                ports: [{ port: 9090, targetPort: "http", name: "http" }],
            },
        }, { provider: k8sProvider, parent: this });

        this.serviceName = svc.metadata.name;
        this.serviceUrl = pulumi.interpolate`http://${svc.metadata.name}.${namespace}.svc.cluster.local:9090`;
        this.registerOutputs({ serviceUrl: this.serviceUrl, serviceName: this.serviceName });
    }
}
