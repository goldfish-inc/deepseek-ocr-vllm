import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface AnnotationsSinkArgs {
  k8sProvider: k8s.Provider;
  namespace?: string;
  serviceName?: string;
  replicas?: number;
  hfRepo?: pulumi.Input<string>; // e.g., goldfish-inc/oceanid-annotations
  hfToken?: pulumi.Input<string>; // Pulumi secret from ESC (preferred)
  dbUrl?: pulumi.Input<string>;   // Optional: postgres connection string
  schemaVersion?: pulumi.Input<string>; // e.g., 1.0.0
  // Prefer passing a full immutable image reference (e.g., ghcr.io/...:${GIT_SHA})
  image?: pulumi.Input<string>;
  imageTag?: pulumi.Input<string>;
}

export class AnnotationsSink extends pulumi.ComponentResource {
  public readonly serviceUrl!: pulumi.Output<string>;
  public readonly serviceName!: pulumi.Output<string>;

  constructor(name: string, args: AnnotationsSinkArgs, opts?: pulumi.ComponentResourceOptions) {
    super("oceanid:apps:AnnotationsSink", name, {}, opts);

    const {
      k8sProvider,
      namespace = "apps",
      serviceName = "annotations-sink",
      replicas = 1,
      hfRepo = "goldfish-inc/oceanid-annotations",
      hfToken,
      dbUrl,
      schemaVersion = "1.0.0",
      image,
      imageTag,
    } = args;

    const cfgPulumi = new pulumi.Config();

    const env: any[] = [
      { name: "SCHEMA_VERSION", value: schemaVersion },
      { name: "HF_REPO", value: hfRepo },
      { name: "SUBDIR_TEMPLATE", value: "schema-{schema_version}" },
    ];

    // Add HF token from args or config
    const finalHfToken = hfToken || cfgPulumi.getSecret("hfToken");
    if (finalHfToken) {
      env.push({ name: "HF_TOKEN", value: finalHfToken });
    }

    // Add database URL from args or config
    const finalDbUrl = dbUrl || cfgPulumi.getSecret("postgresUrl");
    if (finalDbUrl) {
      env.push({ name: "DATABASE_URL", value: finalDbUrl });
    }

    // Prefer a full immutable image ref (e.g., ghcr.io/...:${GIT_SHA})
    const sinkImage = cfgPulumi.get("sinkImage");
    const sinkImageTag = cfgPulumi.get("sinkImageTag") || "main";
    const baseSinkImage = "ghcr.io/goldfish-inc/oceanid/annotations-sink";
    const sinkImageRef = sinkImage || pulumi.interpolate`${baseSinkImage}:${sinkImageTag}`;

    const deploy = new k8s.apps.v1.Deployment(`${name}-deploy`, {
      metadata: { name: serviceName, namespace },
      spec: {
        replicas,
        selector: { matchLabels: { app: serviceName } },
        template: {
          metadata: { labels: { app: serviceName } },
          spec: {
            imagePullSecrets: [{ name: "ghcr-creds" }],
            containers: [{
              name: "sink",
              image: sinkImageRef as any,
              env,
              ports: [{ containerPort: 8080, name: "http" }],
              readinessProbe: { httpGet: { path: "/health", port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10 },
              livenessProbe: { httpGet: { path: "/health", port: 8080 }, initialDelaySeconds: 10, periodSeconds: 20 },
              resources: { requests: { cpu: "10m", memory: "16Mi" }, limits: { cpu: "100m", memory: "50Mi" } },
            }],
          },
        },
      },
    }, { provider: k8sProvider, parent: this });

    const svc = new k8s.core.v1.Service(`${name}-svc`, {
      metadata: { name: serviceName, namespace },
      spec: {
        selector: { app: serviceName },
        ports: [{ port: 8080, targetPort: "http", name: "http" }],
      },
    }, { provider: k8sProvider, parent: this });

    this.serviceName = svc.metadata.name;
    this.serviceUrl = pulumi.interpolate`http://${svc.metadata.name}.${namespace}.svc.cluster.local:8080`;
    this.registerOutputs({ serviceUrl: this.serviceUrl, serviceName: this.serviceName });
  }
}
