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

    // ServiceMonitor for ls-triton-adapter
    new k8s.apiextensions.CustomResource(`${name}-adapter-sm`, {
      apiVersion: "monitoring.coreos.com/v1",
      kind: "ServiceMonitor",
      metadata: {
        name: "ls-triton-adapter",
        namespace,
        labels: { release: release.name },
      },
      spec: {
        selector: { matchLabels: { app: "ls-triton-adapter" } },
        namespaceSelector: { matchNames: ["apps"] },
        endpoints: [
          { port: "http", interval: scrapeInterval, path: "/metrics" },
        ],
      },
    }, { provider: k8sProvider, parent: ns, dependsOn: [release] });

    // Triton adapter health alerts
    new k8s.apiextensions.CustomResource(`${name}-triton-alerts`, {
      apiVersion: "monitoring.coreos.com/v1",
      kind: "PrometheusRule",
      metadata: {
        name: "triton-adapter-alerts",
        namespace,
        labels: { release: release.name },
      },
      spec: {
        groups: [
          {
            name: "triton-adapter",
            rules: [
              {
                alert: "TritonAdapterDown",
                expr: "up{job=\"ls-triton-adapter\"} == 0",
                for: "2m",
                labels: { severity: "critical" },
                annotations: {
                  summary: "Triton adapter unavailable",
                  description: "ls-triton-adapter has been down for >2min. PDF predictions will fail.",
                },
              },
              {
                alert: "TritonAdapterUnhealthy",
                // Use native target availability since we scrape /health directly
                expr: "up{job=\"ls-triton-adapter\"} == 0",
                for: "1m",
                labels: { severity: "warning" },
                annotations: {
                  summary: "Triton adapter health check failing",
                  description: "Prometheus scrape/health check is failing for ls-triton-adapter. Verify adapter pods and Triton GPU service connectivity (Calypso 192.168.2.110).",
                },
              },
            ],
          },
        ],
      },
    }, { provider: k8sProvider, parent: ns, dependsOn: [release] });

    // Alert when Flux or Pulumi controllers enter sustained CrashLoopBackOff states
    new k8s.apiextensions.CustomResource(`${name}-controller-restart-alerts`, {
      apiVersion: "monitoring.coreos.com/v1",
      kind: "PrometheusRule",
      metadata: {
        name: "controller-restarts",
        namespace,
        labels: { release: release.name },
      },
      spec: {
        groups: [
          {
            name: "controller-restarts",
            rules: [
              {
                alert: "FluxControllersCrashLooping",
                expr: "sum(kube_pod_container_status_waiting_reason{namespace=\"flux-system\",reason=\"CrashLoopBackOff\"}) > 0",
                for: "5m",
                labels: { severity: "warning" },
                annotations: {
                  summary: "Flux controllers stuck in CrashLoopBackOff",
                  description: "One or more Flux controllers have been in CrashLoopBackOff for over 5 minutes. Investigate Kubernetes API reachability and Flux pod logs.",
                },
              },
              {
                alert: "PulumiOperatorCrashLooping",
                expr: "sum(kube_pod_container_status_waiting_reason{namespace=\"pulumi-system\",reason=\"CrashLoopBackOff\"}) > 0",
                for: "5m",
                labels: { severity: "warning" },
                annotations: {
                  summary: "Pulumi operator stuck in CrashLoopBackOff",
                  description: "The Pulumi Kubernetes Operator has been in CrashLoopBackOff for over 5 minutes. Confirm cluster networking and operator access to the Kubernetes API.",
                },
              },
            ],
          },
        ],
      },
    }, { provider: k8sProvider, parent: ns, dependsOn: [release] });

    this.registerOutputs({});
  }
}
