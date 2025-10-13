import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface ProjectBootstrapperArgs {
  k8sProvider: k8s.Provider;
  namespace?: string;
  serviceName?: string;
  replicas?: number;
  // Label Studio
  labelStudioUrl: pulumi.Input<string>; // e.g., https://label.boathou.se
  labelStudioPat: pulumi.Input<string>; // Personal Access Token (PAT)
  // ML backends
  nerBackendUrl: pulumi.Input<string>; // e.g., http://ls-triton-adapter.apps.svc.cluster.local:9090
  tabertBackendUrl?: pulumi.Input<string>; // optional experimental backend
  // Annotations sink endpoints (optional verify/registration)
  sinkIngestUrl?: pulumi.Input<string>; // e.g., http://annotations-sink.apps.svc.cluster.local:8080/ingest
  sinkWebhookUrl?: pulumi.Input<string>; // e.g., http://annotations-sink.apps.svc.cluster.local:8080/webhook
  // Labels (JSON array of strings). If omitted, service will fall back to defaults
  nerLabelsJson?: pulumi.Input<string>;
  // CORS allowed origins (Label Studio URL, docs site URL)
  allowedOrigins?: pulumi.Input<string[]>;
  // S3 configuration for per-project storage
  s3Bucket?: pulumi.Input<string>; // S3 bucket name
  s3Region?: pulumi.Input<string>; // AWS region
  s3Endpoint?: pulumi.Input<string>; // S3 endpoint URL (optional)
  awsAccessKeyId?: pulumi.Input<string>; // AWS access key
  awsSecretAccessKey?: pulumi.Input<string>; // AWS secret key
  // Prefer passing a full immutable image reference (e.g., ghcr.io/...:${GIT_SHA})
  image?: pulumi.Input<string>;
  imageTag?: pulumi.Input<string>;
}

export class ProjectBootstrapper extends pulumi.ComponentResource {
  public readonly serviceUrl!: pulumi.Output<string>;
  public readonly serviceName!: pulumi.Output<string>;

  constructor(name: string, args: ProjectBootstrapperArgs, opts?: pulumi.ComponentResourceOptions) {
    super("oceanid:apps:ProjectBootstrapper", name, {}, opts);

    const {
      k8sProvider,
      namespace = "apps",
      serviceName = "project-bootstrapper",
      replicas = 1,
      labelStudioUrl,
      labelStudioPat,
      nerBackendUrl,
      tabertBackendUrl,
      sinkIngestUrl,
      sinkWebhookUrl,
      nerLabelsJson,
      allowedOrigins = ["https://label.boathou.se"],
      s3Bucket,
      s3Region = "us-east-1",
      s3Endpoint,
      awsAccessKeyId,
      awsSecretAccessKey,
      image,
      imageTag,
    } = args;

    const labels = { app: serviceName, egress: "external" };

    // Prefer a full immutable image ref (e.g., ghcr.io/...:${GIT_SHA})
    const bootstrapperImageTag = imageTag || "main";
    const baseBootstrapperImage = "ghcr.io/goldfish-inc/oceanid/project-bootstrapper";
    const bootstrapperImageRef = image || pulumi.interpolate`${baseBootstrapperImage}:${bootstrapperImageTag}`;

    const deploy = new k8s.apps.v1.Deployment(`${serviceName}-deploy`, {
      metadata: { name: serviceName, namespace },
      spec: {
        replicas,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            imagePullSecrets: [{ name: "ghcr-creds" }],
            containers: [
              {
                name: serviceName,
                image: bootstrapperImageRef as any,
                ports: [{ name: "http", containerPort: 8080 }],
                env: [
                  { name: "LS_URL", value: labelStudioUrl as any },
                  { name: "LS_PAT", value: labelStudioPat as any },
                  { name: "NER_BACKEND_URL", value: nerBackendUrl as any },
                  ...(tabertBackendUrl ? [{ name: "TABERT_BACKEND_URL", value: tabertBackendUrl as any }] : []),
                  ...(sinkIngestUrl ? [{ name: "SINK_INGEST_URL", value: sinkIngestUrl as any }] : []),
                  ...(sinkWebhookUrl ? [{ name: "SINK_WEBHOOK_URL", value: sinkWebhookUrl as any }] : []),
                  ...(nerLabelsJson ? [{ name: "NER_LABELS_JSON", value: nerLabelsJson as any }] : []),
                  { name: "ALLOWED_ORIGINS", value: pulumi.output(allowedOrigins).apply(a => JSON.stringify(a)) as any },
                  // Route external HTTP(S) via egress gateway proxy; keep in-cluster direct
                  { name: "HTTP_PROXY", value: "http://egress-gateway.egress-system.svc.cluster.local:3128" },
                  { name: "HTTPS_PROXY", value: "http://egress-gateway.egress-system.svc.cluster.local:3128" },
                  { name: "NO_PROXY", value: ".svc,.svc.cluster.local,10.42.0.0/16,10.43.0.0/16" },
                  ...(s3Bucket ? [{ name: "S3_BUCKET", value: s3Bucket as any }] : []),
                  ...(s3Region ? [{ name: "AWS_REGION", value: s3Region as any }] : []),
                  ...(s3Endpoint ? [{ name: "S3_ENDPOINT", value: s3Endpoint as any }] : []),
                  ...(awsAccessKeyId ? [{ name: "AWS_ACCESS_KEY_ID", value: awsAccessKeyId as any }] : []),
                  ...(awsSecretAccessKey ? [{ name: "AWS_SECRET_ACCESS_KEY", value: awsSecretAccessKey as any }] : []),
                  { name: "LISTEN_ADDR", value: ":8080" },
                ],
                resources: { requests: { cpu: "10m", memory: "16Mi" }, limits: { cpu: "100m", memory: "64Mi" } },
              },
            ],
          },
        },
      },
    }, { provider: k8sProvider, parent: this });

    const svc = new k8s.core.v1.Service(`${serviceName}-svc`, {
      metadata: { name: serviceName, namespace },
      spec: {
        type: "ClusterIP",
        selector: labels,
        ports: [{ name: "http", protocol: "TCP", port: 8080, targetPort: "http" as any }],
      },
    }, { provider: k8sProvider, parent: this });

    this.serviceUrl = pulumi.interpolate`http://${serviceName}.${namespace}.svc.cluster.local:8080`;
    this.serviceName = pulumi.output(serviceName);

    this.registerOutputs({
      serviceUrl: this.serviceUrl,
      serviceName: this.serviceName,
    });
  }
}
