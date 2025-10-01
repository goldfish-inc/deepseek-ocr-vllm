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
                                    ...(mlBackendUrl ? [{ name: "LABEL_STUDIO_ML_BACKEND_URL", value: mlBackendUrl }] : []),
                                    ...(dbUrl ? [{ name: "DATABASE_URL", value: dbUrl as any }] : []),
                                    ...(hostUrl ? [{ name: "LABEL_STUDIO_HOST", value: hostUrl as any }] : []),
                                    ...(adminEmail ? [{ name: "LABEL_STUDIO_USERNAME", value: adminEmail as any }] : []),
                                    ...(adminPassword ? [{ name: "LABEL_STUDIO_PASSWORD", value: adminPassword as any }] : []),
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
        }, { provider: k8sProvider, parent: this, dependsOn: [ns] });

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
