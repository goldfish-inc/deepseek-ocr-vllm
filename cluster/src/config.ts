import { Config, Output, getStack } from "@pulumi/pulumi";

export interface ContainerResourceValues extends Record<string, string> {
    cpu: string;
    memory: string;
}

export interface ContainerResourceRequirements {
    requests: ContainerResourceValues;
    limits: ContainerResourceValues;
}

type ContainerResourceOverrides = Partial<{
    requests: Partial<ContainerResourceValues>;
    limits: Partial<ContainerResourceValues>;
}>;

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
    tunnelResources: ContainerResourceRequirements;
}

export interface NodeTunnelHostnames {
    base: string;
    gpu: string;
    nodesWildcard: string;
    podsWildcard: string;
}

export interface NodeTunnelConfig {
    tunnelId: string;
    tunnelToken: Output<string>;
    hostname: string;
    hostnames: NodeTunnelHostnames;
    target: string;
    metricsPort: number;
    image: string;
    resources: ContainerResourceRequirements;
    zoneId: string;
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
    nodeTunnel: NodeTunnelConfig;
    gitops: GitOpsConfig;
}

const cfg = new Config();
const stack = getStack();

const kubeconfigPath = cfg.get("kubeconfigPath") ?? process.env.KUBECONFIG ?? "./kubeconfig.yaml";
const clusterName = cfg.get("clusterName") ?? `oceanid-${stack}`;

const tunnelId = cfg.get("cloudflare_tunnel_id") ?? cfg.require("cloudflareTunnelId");

const defaultTunnelResources: ContainerResourceRequirements = {
    requests: {
        cpu: "200m",
        memory: "256Mi",
    },
    limits: {
        cpu: "500m",
        memory: "512Mi",
    },
};

const tunnelResourceOverrides =
    cfg.getObject<ContainerResourceOverrides>("cloudflareTunnelResources") ??
    cfg.getObject<ContainerResourceOverrides>("cloudflare_tunnel_resources") ??
    null;

const tunnelResources = mergeResourceRequirements(defaultTunnelResources, tunnelResourceOverrides);

const nodeTunnelId = cfg.get("cloudflare_node_tunnel_id") ?? cfg.get("cloudflareNodeTunnelId") ?? cfg.require("cloudflareNodeTunnelId");
const nodeTunnelToken =
    cfg.getSecret("cloudflare_node_tunnel_token") ??
    cfg.getSecret("cloudflareNodeTunnelToken") ??
    cfg.requireSecret("cloudflareNodeTunnelToken");

const nodeTunnelHostname =
    cfg.get("cloudflare_node_tunnel_hostname") ??
    cfg.get("cloudflareNodeTunnelHostname") ??
    cfg.require("cloudflareNodeTunnelHostname");

const nodeTunnelHostnames: NodeTunnelHostnames = {
    base: nodeTunnelHostname,
    gpu: `gpu.${nodeTunnelHostname}`,
    nodesWildcard: `*.nodes.${nodeTunnelHostname}`,
    podsWildcard: `*.pod.${nodeTunnelHostname}`,
};

const nodeTunnelTarget =
    cfg.get("cloudflare_node_tunnel_target") ??
    cfg.get("cloudflareNodeTunnelTarget") ??
    `${nodeTunnelId}.cfargotunnel.com`;

const nodeTunnelMetricsPort =
    cfg.getNumber("cloudflare_node_tunnel_metrics_port") ??
    cfg.getNumber("cloudflareNodeTunnelMetricsPort") ??
    2200;

const nodeTunnelImage =
    cfg.get("cloudflare_node_tunnel_image") ??
    cfg.get("cloudflareNodeTunnelImage") ??
    cfg.get("cloudflared_node_image") ??
    cfg.get("cloudflaredNodeImage") ??
    "cloudflare/cloudflared:2025.9.1";

const nodeTunnelResourceOverrides =
    cfg.getObject<ContainerResourceOverrides>("cloudflare_node_tunnel_resources") ??
    cfg.getObject<ContainerResourceOverrides>("cloudflareNodeTunnelResources") ??
    null;

const nodeTunnelResources = mergeResourceRequirements(tunnelResources, nodeTunnelResourceOverrides);

const nodeTunnelZoneId =
    cfg.get("cloudflare_node_tunnel_zone_id") ??
    cfg.get("cloudflareNodeTunnelZoneId") ??
    (cfg.get("cloudflare_zone_id") ?? cfg.require("cloudflareZoneId"));

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
        tunnelHostname:
            cfg.get("cloudflare_tunnel_hostname") ?? cfg.get("cloudflareTunnelHostname") ?? "k3s.boathou.se",
        tunnelServiceUrl:
            cfg.get("cloudflare_tunnel_service_url") ??
            cfg.get("cloudflareTunnelServiceUrl") ??
            "https://kubernetes.default.svc.cluster.local:443",
        tunnelTarget:
            cfg.get("cloudflare_tunnel_target") ?? cfg.get("cloudflareTunnelTarget") ?? `${tunnelId}.cfargotunnel.com`,
        image: cfg.get("cloudflared_image") ?? cfg.get("cloudflaredImage") ?? "cloudflare/cloudflared:2025.9.1",
        tunnelResources,
    },
    nodeTunnel: {
        tunnelId: nodeTunnelId,
        tunnelToken: nodeTunnelToken,
        hostname: nodeTunnelHostname,
        hostnames: nodeTunnelHostnames,
        target: nodeTunnelTarget,
        metricsPort: nodeTunnelMetricsPort,
        image: nodeTunnelImage,
        resources: nodeTunnelResources,
        zoneId: nodeTunnelZoneId,
    },
    gitops: {
        repositoryUrl: cfg.get("gitRepositoryUrl") ?? "https://github.com/goldfish-inc/oceanid",
        branch: cfg.get("gitRepositoryBranch") ?? "main",
        path: cfg.get("gitRepositoryPath") ?? "clusters/tethys",
        intervalSeconds: cfg.getNumber("gitRepositoryIntervalSeconds") ?? 60,
        reconciliationSeconds: cfg.getNumber("gitReconciliationSeconds") ?? 600,
    },
};

function mergeResourceRequirements(
    defaults: ContainerResourceRequirements,
    overrides?: ContainerResourceOverrides | null
): ContainerResourceRequirements {
    if (!overrides) {
        return defaults;
    }

    return {
        requests: {
            cpu: overrides.requests?.cpu ?? defaults.requests.cpu,
            memory: overrides.requests?.memory ?? defaults.requests.memory,
        },
        limits: {
            cpu: overrides.limits?.cpu ?? defaults.limits.cpu,
            memory: overrides.limits?.memory ?? defaults.limits.memory,
        },
    };
}
