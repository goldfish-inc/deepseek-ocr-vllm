import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface K3sNetworkReconfigArgs {
    /**
     * Node hostname
     */
    nodeName: string;

    /**
     * Node IP address for SSH access
     */
    nodeIp: string;

    /**
     * SSH private key for authentication
     */
    sshPrivateKey: pulumi.Input<string>;

    /**
     * SSH user (default: root)
     */
    sshUser?: string;

    /**
     * New node IP for K3s to bind to
     */
    k3sNodeIp: string;

    /**
     * Network interface for Flannel to use
     */
    flannelIface: string;

    /**
     * K3s service type: "server" or "agent"
     */
    serviceType: "server" | "agent";

    /**
     * Whether to restart K3s after reconfiguration
     */
    restartService?: boolean;
}

/**
 * Reconfigures K3s networking to use specified interface and IP
 *
 * This component updates K3s systemd service to use:
 * - --node-ip: IP address for node communication
 * - --flannel-iface: Network interface for Flannel overlay
 *
 * Use cases:
 * - Switch from Tailscale to eth0 for VPS nodes (direct connectivity)
 * - Keep Tailscale for private network nodes (tunneled connectivity)
 */
export class K3sNetworkReconfiguration extends pulumi.ComponentResource {
    public readonly configured: pulumi.Output<string>;

    constructor(
        name: string,
        args: K3sNetworkReconfigArgs,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("oceanid:infrastructure:K3sNetworkReconfiguration", name, {}, opts);

        const serviceName = args.serviceType === "server" ? "k3s" : "k3s-agent";
        const restartService = args.restartService ?? true;

        // Reconfigure K3s networking
        const reconfigure = new command.remote.Command(
            `${name}-reconfig`,
            {
                connection: {
                    host: args.nodeIp,
                    user: args.sshUser || "root",
                    privateKey: args.sshPrivateKey,
                },
                create: pulumi.interpolate`
                    set -e
                    echo "Reconfiguring ${serviceName} networking on ${args.nodeName}..."

                    # Stop K3s service
                    systemctl stop ${serviceName} || true

                    # Backup current config if not already backed up
                    if [ ! -f /root/${serviceName}.service.backup ]; then
                        cp /etc/systemd/system/${serviceName}.service /root/${serviceName}.service.backup
                        echo "Backed up original config to /root/${serviceName}.service.backup"
                    fi

                    # Update node IP and Flannel interface
                    sed -i 's|--node-ip=[^ ]*|--node-ip=${args.k3sNodeIp}|g' /etc/systemd/system/${serviceName}.service
                    sed -i 's|--flannel-iface=[^ ]*|--flannel-iface=${args.flannelIface}|g' /etc/systemd/system/${serviceName}.service

                    # If flags don't exist, add them
                    if ! grep -q "node-ip" /etc/systemd/system/${serviceName}.service; then
                        sed -i "/^ExecStart=.*${args.serviceType}/a\\        --node-ip=${args.k3sNodeIp} \\\\" /etc/systemd/system/${serviceName}.service
                    fi
                    if ! grep -q "flannel-iface" /etc/systemd/system/${serviceName}.service; then
                        sed -i "/^ExecStart=.*${args.serviceType}/a\\        --flannel-iface=${args.flannelIface} \\\\" /etc/systemd/system/${serviceName}.service
                    fi

                    # Reload systemd
                    systemctl daemon-reload

                    ${restartService ? `
                    # Restart K3s
                    systemctl start ${serviceName}

                    # Wait for service to be active
                    sleep 10
                    systemctl is-active ${serviceName}
                    ` : "echo 'Service restart skipped'"}

                    echo "K3s networking reconfigured: node-ip=${args.k3sNodeIp}, flannel-iface=${args.flannelIface}"
                `,
                triggers: [
                    args.k3sNodeIp,
                    args.flannelIface,
                ],
            },
            { parent: this }
        );

        this.configured = reconfigure.stdout;

        this.registerOutputs({
            configured: this.configured,
        });
    }
}
