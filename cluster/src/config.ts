import { Config, Output, getStack } from "@pulumi/pulumi";

export interface CloudflareConfig {
    accountId: string;
    zoneId: string;
    apiToken: Output<string>;
    tunnelId: string;
    tunnelToken: Output<string>;
    tunnelHostname: string;
    tunnelServiceUrl: string;
    tunnelTarget: string;
    image: string;
}

export interface GitOpsConfig {
    repositoryUrl: string;
    branch: string;
    path: string;
    intervalSeconds: number;
    reconciliationSeconds: number;
}

export interface ClusterConfig {
    name: string;
    kubeconfigPath: string;
    metricsPort: number;
    cloudflare: CloudflareConfig;
    gitops: GitOpsConfig;
}

const cfg = new Config();

const stack = getStack();

const kubeconfigPath = cfg.get("kubeconfigPath") ?? process.env.KUBECONFIG ?? "./kubeconfig.yaml";
const clusterName = cfg.get("clusterName") ?? `oceanid-${stack}`;

const tunnelId = cfg.require("cloudflareTunnelId");

export const clusterConfig: ClusterConfig = {
    name: clusterName,
    kubeconfigPath,
    metricsPort: cfg.getNumber("metricsPort") ?? 2000,
    cloudflare: {
        accountId: cfg.require("cloudflareAccountId"),
        zoneId: cfg.require("cloudflareZoneId"),
        apiToken: cfg.requireSecret("cloudflareApiToken"),
        tunnelId,
        tunnelToken: cfg.requireSecret("cloudflareTunnelToken"),
        tunnelHostname: cfg.get("cloudflareTunnelHostname") ?? cfg.require("tunnelHostname"),
        tunnelServiceUrl: cfg.get("cloudflareTunnelServiceUrl") ?? cfg.require("tunnelServiceUrl"),
        tunnelTarget: cfg.get("cloudflareTunnelTarget") ?? `${tunnelId}.cfargotunnel.com`,
        image: cfg.get("cloudflaredImage") ?? "cloudflare/cloudflared:2024.9.1",
    },
    gitops: {
        repositoryUrl: cfg.get("gitRepositoryUrl") ?? "https://github.com/goldfish-inc/oceanid",
        branch: cfg.get("gitRepositoryBranch") ?? "main",
        path: cfg.get("gitRepositoryPath") ?? "clusters/tethys",
        intervalSeconds: cfg.getNumber("gitRepositoryIntervalSeconds") ?? 60,
        reconciliationSeconds: cfg.getNumber("gitReconciliationSeconds") ?? 600,
    },
};
