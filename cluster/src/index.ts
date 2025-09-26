import * as pulumi from "@pulumi/pulumi";

import { clusterConfig } from "./config";
import { cloudflareProvider, k8sProvider, kubeconfigPath } from "./providers";
import { CloudflareTunnel } from "./components/cloudflareTunnel";
import { FluxBootstrap } from "./components/fluxBootstrap";

const tunnel = new CloudflareTunnel("cloudflare", {
    cluster: clusterConfig,
    k8sProvider,
    cloudflareProvider,
});

const flux = new FluxBootstrap("gitops", {
    cluster: clusterConfig,
    k8sProvider,
});

export const outputs = {
    kubeconfigPath,
    cloudflareNamespace: tunnel.outputs.namespace,
    cloudflareDeployment: tunnel.outputs.deploymentName,
    cloudflareMetricsService: tunnel.outputs.metricsServiceName,
    cloudflareDnsRecord: tunnel.outputs.dnsRecordName,
    fluxNamespace: flux.namespace,
    gitRepository: clusterConfig.gitops.repositoryUrl,
    gitPath: clusterConfig.gitops.path,
};
