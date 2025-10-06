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
}

export class LsTritonAdapter extends pulumi.ComponentResource {
    public readonly serviceUrl: pulumi.Output<string>;
    public readonly serviceName: pulumi.Output<string>;

    constructor(name: string, args: LsTritonAdapterArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:ml:LsTritonAdapter", name, {}, opts);

        const { k8sProvider, namespace = "apps", serviceName = "ls-triton-adapter", tritonBaseUrl, cfAccessClientId, cfAccessClientSecret } = args;

        // Use existing namespace rather than creating a new one
        // The 'apps' namespace is created by LabelStudio component
        const nsName = pulumi.output(namespace);

        const sentry = getSentrySettings();
        const cfgPulumi = new pulumi.Config();
        const defaultLabels = [
            "O","VESSEL","HS_CODE","PORT","COMMODITY","IMO","FLAG","RISK_LEVEL","DATE"
        ];
        const nerLabelsFromConfig = cfgPulumi.getSecret("nerLabels");

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

        const envBase = {
            TRITON_BASE_URL: tritonBaseUrl,
            DEFAULT_MODEL: "distilbert-base-uncased",
            ...toEnvVars(sentry),
        } as Record<string, pulumi.Input<string>>;

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

        const deploy = new k8s.apps.v1.Deployment(`${name}-deploy`, {
            metadata: { name: serviceName, namespace },
            spec: {
                replicas: 1,
                selector: { matchLabels: { app: serviceName } },
                template: {
                    metadata: { labels: { app: serviceName } },
                    spec: {
                        imagePullSecrets: [{ name: "ghcr-creds" }],
                        containers: [{
                            name: "adapter",
                            image: cfgPulumi.get("adapterImage") || "ghcr.io/goldfish-inc/oceanid/ls-triton-adapter:main",
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
