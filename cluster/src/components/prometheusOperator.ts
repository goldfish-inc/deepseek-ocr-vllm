import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface PrometheusOperatorArgs {
  k8sProvider: k8s.Provider;
  namespace?: string; // default: monitoring
  remoteWrite?: {
    url: pulumi.Input<string>;
    username?: pulumi.Input<string>; // Grafana Cloud instance ID
    password?: pulumi.Input<string>; // Grafana Cloud API key
  };
  scrapeInterval?: string; // default: 60s
}

export class PrometheusOperator extends pulumi.ComponentResource {
  constructor(name: string, args: PrometheusOperatorArgs, opts?: pulumi.ComponentResourceOptions) {
    super("oceanid:monitoring:PrometheusOperator", name, {}, opts);

    const {
      k8sProvider,
      namespace = "monitoring",
      remoteWrite,
      scrapeInterval = "60s",
    } = args;

    const ns = new k8s.core.v1.Namespace(`${name}-ns`, {
      metadata: { name: namespace },
    }, { provider: k8sProvider, parent: this });

    // Helm repo: prometheus-community/kube-prometheus-stack
    const release = new k8s.helm.v3.Release(`${name}-kps`, {
      namespace,
      chart: "kube-prometheus-stack",
      repositoryOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
      version: "58.2.0",
      values: {
        grafana: { enabled: false },
        alertmanager: { enabled: false },
        kubeEtcd: { enabled: false },
        kubeControllerManager: { enabled: false },
        kubeScheduler: { enabled: false },
        kubeProxy: { enabled: false },
        prometheus: {
          prometheusSpec: {
            scrapeInterval,
            // Keep local storage minimal
            retention: "1d",
            walCompression: true,
            enableAdminAPI: false,
            remoteWrite: remoteWrite ? [
              {
                url: remoteWrite.url,
                basicAuth: remoteWrite.username && remoteWrite.password ? {
                  username: { name: `${name}-rw`, key: "username" },
                  password: { name: `${name}-rw`, key: "password" },
                } : undefined,
              },
            ] : [],
          },
        },
      },
    }, { provider: k8sProvider, parent: ns });

    // Secret for remote write creds (optional)
    if (remoteWrite && remoteWrite.username && remoteWrite.password) {
      new k8s.core.v1.Secret(`${name}-rw`, {
        metadata: { name: `${name}-rw`, namespace },
        stringData: {
          username: remoteWrite.username as any,
          password: remoteWrite.password as any,
        },
      }, { provider: k8sProvider, parent: ns, dependsOn: [release] });
    }

    // ServiceMonitor for annotations-sink
    new k8s.apiextensions.CustomResource(`${name}-sink-sm`, {
      apiVersion: "monitoring.coreos.com/v1",
      kind: "ServiceMonitor",
      metadata: {
        name: "annotations-sink",
        namespace,
        labels: { release: release.name },
      },
      spec: {
        selector: { matchLabels: { app: "annotations-sink" } },
        namespaceSelector: { matchNames: ["apps"] },
        endpoints: [
          { port: "http", interval: scrapeInterval, path: "/metrics" },
        ],
      },
    }, { provider: k8sProvider, parent: ns, dependsOn: [release] });

    // ServiceMonitor for csv-ingestion-worker
    new k8s.apiextensions.CustomResource(`${name}-csv-sm`, {
      apiVersion: "monitoring.coreos.com/v1",
      kind: "ServiceMonitor",
      metadata: {
        name: "csv-ingestion-worker",
        namespace,
        labels: { release: release.name },
      },
      spec: {
        selector: { matchLabels: { app: "csv-ingestion-worker" } },
        namespaceSelector: { matchNames: ["apps"] },
        endpoints: [
          { port: "http", interval: scrapeInterval, path: "/metrics" },
        ],
      },
    }, { provider: k8sProvider, parent: ns, dependsOn: [release] });

    this.registerOutputs({});
  }
}
