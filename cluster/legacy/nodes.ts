import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

// =============================================================================
// NODE CONFIGURATION
// =============================================================================

const config = new pulumi.Config();

// Get node configuration from Pulumi ESC
export interface NodeConfig {
    hostname: string;
    ip: string;
    role: "master" | "worker";
    gpu?: string;
    labels?: Record<string, string>;
}

// Nodes configuration from ESC
export const nodes: Record<string, NodeConfig> = {
    tethys: {
        hostname: "srv712429",
        ip: config.require("tethysIp"),
        role: "master",
        labels: {
            "node-role.kubernetes.io/control-plane": "true",
            "oceanid.cluster/node": "tethys",
            "oceanid.cluster/provider": "hostinger"
        }
    },
    styx: {
        hostname: "srv712695",
        ip: config.require("styxIp"),
        role: "worker",
        labels: {
            "node-role.kubernetes.io/worker": "true",
            "oceanid.cluster/node": "styx",
            "oceanid.cluster/provider": "hostinger"
        }
    },
    calypso: {
        hostname: "calypso",
        ip: "192.168.2.80",
        role: "worker",
        gpu: "rtx4090",
        labels: {
            "node-role.kubernetes.io/worker": "true",
            "node.kubernetes.io/instance-type": "gpu",
            "oceanid.cluster/node": "calypso",
            "oceanid.cluster/gpu": "rtx4090",
            "oceanid.cluster/provider": "local"
        }
    },
    meliae: {
        hostname: "meliae",
        ip: "140.238.138.35",
        role: "worker",
        labels: {
            "node-role.kubernetes.io/worker": "true",
            "oceanid.cluster/node": "meliae",
            "oceanid.cluster/provider": "oracle"
        }
    }
};

// =============================================================================
// K3S TOKEN MANAGEMENT
// =============================================================================

// K3s configuration from ESC
export const k3sConfig = {
    token: config.requireSecret("k3s_token"),
    serverUrl: config.get("k3s_server_url") || "https://tethys.boathou.se:6443",
    version: config.get("k3s_version") || "v1.33.4+k3s1"
};

// =============================================================================
// NODE PROVISIONING
// =============================================================================

// Function to check node health
export async function checkNodeHealth(nodeName: string): Promise<boolean> {
    const node = nodes[nodeName];
    if (!node) {
        return false;
    }

    const healthCheck = new command.local.Command(`check-${nodeName}-health`, {
        create: `kubectl get node ${node.hostname} -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "False"`,
        environment: {
            KUBECONFIG: process.env.KUBECONFIG || "./kubeconfig.yaml"
        }
    });

    const result = await healthCheck.stdout;
    return result === "True";
}

// =============================================================================
// EXPORTS
// =============================================================================

export const nodeStatus = pulumi.output(Promise.all(
    Object.keys(nodes).map(async (name) => ({
        name,
        ...nodes[name],
        healthy: await checkNodeHealth(name)
    }))
));

export const clusterInfo = {
    nodes: nodes,
    k3s: k3sConfig,
    masterIp: nodes.tethys.ip,
    workerCount: Object.values(nodes).filter(n => n.role === "worker").length,
    gpuNodes: Object.entries(nodes)
        .filter(([_, node]) => node.gpu)
        .map(([name, node]) => ({ name, gpu: node.gpu }))
};
