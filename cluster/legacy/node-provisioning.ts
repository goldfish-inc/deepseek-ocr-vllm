import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import * as tls from "@pulumi/tls";
import { nodes, k3sConfig } from "./nodes";

// =============================================================================
// SSH KEY MANAGEMENT (Stored securely in Pulumi ESC)
// =============================================================================

// SSH keys are now stored in Pulumi ESC (Environments, Secrets, and Configuration)
// This allows for secure storage and rotation of SSH keys
//
// Keys are stored as base64-encoded secrets in ESC and automatically decoded
// when accessed by Pulumi configuration
//
// To rotate SSH keys:
// 1. Generate new SSH keys
// 2. Run: ./scripts/migrate-ssh-to-esc.sh
// 3. Deploy changes: pulumi up

// =============================================================================
// NODE PROVISIONING WITH PULUMI
// =============================================================================

export class K3sNode extends pulumi.ComponentResource {
    public readonly nodeReady: pulumi.Output<boolean>;

    constructor(
        name: string,
        args: {
            host: string;
            user: string;
            privateKey: pulumi.Input<string>;
            role: "master" | "worker";
            k3sToken: pulumi.Input<string>;
            k3sServerUrl?: pulumi.Input<string>;
            labels?: Record<string, string>;
        },
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("oceanid:infrastructure:K3sNode", name, {}, opts);

        // Step 1: Configure the node
        const configureNode = new command.remote.Command(`${name}-configure`, {
            connection: {
                host: args.host,
                user: args.user,
                privateKey: args.privateKey,
            },
            create: pulumi.interpolate`
                # Update system
                apt-get update && apt-get upgrade -y

                # Configure locale
                locale-gen en_US.UTF-8
                update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

                # Install prerequisites
                apt-get install -y curl wget git

                # Configure firewall
                ufw allow 22/tcp
                ufw allow 6443/tcp
                ufw allow 10250/tcp
                ufw allow 2379:2380/tcp
                ufw allow 30000:32767/tcp
                ufw --force enable

                echo "Node configured successfully"
            `,
        }, { parent: this });

        // Step 2: Install k3s
        const installCommand = args.role === "master"
            ? pulumi.interpolate`curl -sfL https://get.k3s.io | sh -s - server --cluster-init`
            : pulumi.interpolate`curl -sfL https://get.k3s.io | K3S_URL='${args.k3sServerUrl}' K3S_TOKEN='${args.k3sToken}' sh -s - agent`;

        const labelArgs = args.labels
            ? Object.entries(args.labels).map(([k, v]) => `--node-label ${k}=${v}`).join(" ")
            : "";

        const installK3s = new command.remote.Command(`${name}-install-k3s`, {
            connection: {
                host: args.host,
                user: args.user,
                privateKey: args.privateKey,
            },
            create: pulumi.interpolate`
                # Check if k3s is already installed
                if command -v k3s >/dev/null 2>&1; then
                    echo "k3s already installed"
                    exit 0
                fi

                # Install k3s
                ${installCommand} ${labelArgs}

                # Wait for k3s to be ready
                sleep 10

                # Verify installation
                systemctl is-active k3s || systemctl is-active k3s-agent
            `,
            dependsOn: [configureNode],
        }, { parent: this });

        // Step 3: Configure Cloudflare tunnel client (if needed)
        const configureTunnel = new command.remote.Command(`${name}-tunnel`, {
            connection: {
                host: args.host,
                user: args.user,
                privateKey: args.privateKey,
            },
            create: pulumi.interpolate`
                # Install cloudflared
                if ! command -v cloudflared >/dev/null 2>&1; then
                    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
                    dpkg -i /tmp/cloudflared.deb
                fi

                echo "Cloudflare tunnel client ready"
            `,
            dependsOn: [installK3s],
        }, { parent: this });

        // Step 4: Health check
        const healthCheck = new command.remote.Command(`${name}-health`, {
            connection: {
                host: args.host,
                user: args.user,
                privateKey: args.privateKey,
            },
            create: pulumi.interpolate`
                # Check k3s health
                if [ "${args.role}" = "master" ]; then
                    kubectl get nodes || k3s kubectl get nodes
                else
                    systemctl is-active k3s-agent
                fi
            `,
            dependsOn: [configureTunnel],
        }, { parent: this });

        this.nodeReady = healthCheck.stdout.apply(output => output.includes("Ready") || output.includes("active"));

        this.registerOutputs({
            nodeReady: this.nodeReady,
        });
    }
}

// =============================================================================
// PROVISION ALL NODES
// =============================================================================

const config = new pulumi.Config();

// Master node (tethys)
export const tethysMaster = new K3sNode("tethys", {
    host: nodes.tethys.ip,
    user: "root",
    privateKey: config.requireSecret("tethys_ssh_key"),
    role: "master",
    k3sToken: k3sConfig.token,
    labels: nodes.tethys.labels,
});

// Worker nodes
export const styxWorker = new K3sNode("styx", {
    host: nodes.styx.ip,
    user: "root",
    privateKey: config.requireSecret("styx_ssh_key"),
    role: "worker",
    k3sToken: k3sConfig.token,
    k3sServerUrl: k3sConfig.serverUrl,
    labels: nodes.styx.labels,
}, { dependsOn: [tethysMaster] });

export const calypsoWorker = new K3sNode("calypso", {
    host: nodes.calypso.ip,
    user: "oceanid",
    privateKey: config.requireSecret("calypso_ssh_key"),
    role: "worker",
    k3sToken: k3sConfig.token,
    k3sServerUrl: pulumi.interpolate`https://${nodes.tethys.ip}:6443`,
    labels: nodes.calypso.labels,
}, { dependsOn: [tethysMaster] });

// =============================================================================
// OUTPUTS
// =============================================================================

export const provisioningStatus = {
    tethys: tethysMaster.nodeReady,
    styx: styxWorker.nodeReady,
    calypso: calypsoWorker.nodeReady,
};
