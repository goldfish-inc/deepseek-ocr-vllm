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

const tunnelId = cfg.get("cloudflare_tunnel_id") ?? cfg.require("cloudflareTunnelId");

export const clusterConfig: ClusterConfig = {
    name: clusterName,
    kubeconfigPath,
    metricsPort: cfg.getNumber("metricsPort") ?? 2000,
    cloudflare: {
        accountId: cfg.get("cloudflare_account_id") ?? cfg.require("cloudflareAccountId"),
        zoneId: cfg.get("cloudflare_zone_id") ?? cfg.require("cloudflareZoneId"),
        apiToken: cfg.getSecret("cloudflare_api_token") ?? cfg.requireSecret("cloudflareApiToken"),
        tunnelId,
        tunnelToken: cfg.getSecret("cloudflare_tunnel_token") ?? cfg.requireSecret("cloudflareTunnelToken"),
        tunnelHostname: cfg.get("cloudflare_tunnel_hostname") ?? cfg.get("cloudflareTunnelHostname") ?? "k3s.boahou.se",
        tunnelServiceUrl: cfg.get("cloudflare_tunnel_service_url") ?? cfg.get("cloudflareTunnelServiceUrl") ?? "http://kubernetes.default.svc.cluster.local:443",
        tunnelTarget: cfg.get("cloudflare_tunnel_target") ?? cfg.get("cloudflareTunnelTarget") ?? `${tunnelId}.cfargotunnel.com`,
        image: cfg.get("cloudflared_image") ?? cfg.get("cloudflaredImage") ?? "cloudflare/cloudflared:2024.9.1",
    },
    gitops: {
        repositoryUrl: cfg.get("gitRepositoryUrl") ?? "https://github.com/goldfish-inc/oceanid",
        branch: cfg.get("gitRepositoryBranch") ?? "main",
        path: cfg.get("gitRepositoryPath") ?? "clusters/tethys",
        intervalSeconds: cfg.getNumber("gitRepositoryIntervalSeconds") ?? 60,
        reconciliationSeconds: cfg.getNumber("gitReconciliationSeconds") ?? 600,
    },
};
