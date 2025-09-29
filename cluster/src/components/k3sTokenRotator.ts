import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import * as random from "@pulumi/random";

export interface K3sTokenRotatorArgs {
    masterNode: {
        ip: string;
        hostname: string;
        user: string;
        privateKey: pulumi.Input<string>;
    };
    workerNodes: Array<{
        ip: string;
        hostname: string;
        user: string;
        privateKey: pulumi.Input<string>;
    }>;
    escEnvironment: string;
    onePasswordItemId?: string;
    rotationIntervalDays?: number;
    enableAutoRotation?: boolean;
    kubeconfigPath?: string;
}

export interface K3sTokenRotatorOutputs {
    tokenRotationStatus: pulumi.Output<{
        lastRotation: string;
        nextRotation: string;
        tokenHash: string;
        clusterHealthy: boolean;
    }>;
    allNodesReady: pulumi.Output<boolean>;
}

export class K3sTokenRotator extends pulumi.ComponentResource {
    public readonly outputs: K3sTokenRotatorOutputs;

    constructor(name: string, args: K3sTokenRotatorArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:security:K3sTokenRotator", name, {}, opts);

        const {
            masterNode,
            workerNodes,
            escEnvironment,
            onePasswordItemId,
            rotationIntervalDays = 90,
            enableAutoRotation = true,
            kubeconfigPath = "./kubeconfig.yaml"
        } = args;

        // Check if rotation is needed
        const rotationCheck = new command.local.Command(`${name}-rotation-check`, {
            create: pulumi.interpolate`
                # Check if token needs rotation based on ESC metadata
                LAST_ROTATION=$(esc env get ${escEnvironment} --format json | jq -r '.k3s.token_rotated_at // empty' 2>/dev/null || echo "")

                if [ -z "$LAST_ROTATION" ]; then
                    echo "rotation_needed=true"
                    echo "reason=no_previous_rotation"
                elif [ "${enableAutoRotation}" = "false" ]; then
                    echo "rotation_needed=false"
                    echo "reason=auto_rotation_disabled"
                else
                    # Calculate days since last rotation
                    LAST_EPOCH=$(date -d "$LAST_ROTATION" +%s 2>/dev/null || echo "0")
                    NOW_EPOCH=$(date +%s)
                    DAYS_DIFF=$(( (NOW_EPOCH - LAST_EPOCH) / 86400 ))

                    if [ "$DAYS_DIFF" -ge ${rotationIntervalDays} ]; then
                        echo "rotation_needed=true"
                        echo "reason=rotation_interval_exceeded"
                        echo "days_since_rotation=$DAYS_DIFF"
                    else
                        echo "rotation_needed=false"
                        echo "days_since_rotation=$DAYS_DIFF"
                        echo "days_until_rotation=$(( ${rotationIntervalDays} - DAYS_DIFF ))"
                    fi
                fi
            `,
        }, { parent: this });

        // Generate new K3s token
        const tokenSuffix = new random.RandomString(`${name}-token-suffix`, {
            length: 16,
            special: false,
            upper: false,
        }, { parent: this });

        const tokenSecret = new random.RandomString(`${name}-token-secret`, {
            length: 32,
            special: false,
            upper: false,
        }, { parent: this });

        const newToken = pulumi.interpolate`K10${tokenSecret.result}::server:${tokenSuffix.result}`;

        // Update token on master node
        const masterTokenUpdate = new command.remote.Command(`${name}-master-update`, {
            connection: {
                host: masterNode.ip,
                user: masterNode.user,
                privateKey: masterNode.privateKey,
            },
            create: pulumi.interpolate`
                # Backup current token
                cp /var/lib/rancher/k3s/server/token /var/lib/rancher/k3s/server/token.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true

                # Update the token file
                echo '${newToken}' | sudo tee /var/lib/rancher/k3s/server/token > /dev/null

                # Update node-token as well
                echo '${newToken}' | sudo tee /var/lib/rancher/k3s/server/node-token > /dev/null

                # Restart k3s server to apply new token
                sudo systemctl restart k3s

                # Wait for k3s to be ready
                for i in {1..30}; do
                    if sudo k3s kubectl get nodes >/dev/null 2>&1; then
                        echo "Master node ready with new token"
                        break
                    fi
                    echo "Waiting for master to be ready... ($i/30)"
                    sleep 10
                done

                # Verify master is accessible
                sudo k3s kubectl get nodes
            `,
        }, { parent: this, dependsOn: [rotationCheck] });

        // Update worker nodes with new token
        const workerUpdates: command.remote.Command[] = [];
        for (let i = 0; i < workerNodes.length; i++) {
            const worker = workerNodes[i];
            const workerUpdate = new command.remote.Command(`${name}-worker-${i}-update`, {
                connection: {
                    host: worker?.ip || '',
                    user: worker?.user || 'root',
                    privateKey: worker?.privateKey || '',
                },
                create: pulumi.interpolate`
                    # Update K3S_TOKEN in service environment file
                    sudo mkdir -p /etc/systemd/system

                    # Update or create environment file
                    if [ -f /etc/systemd/system/k3s-agent.service.env ]; then
                        sudo cp /etc/systemd/system/k3s-agent.service.env /etc/systemd/system/k3s-agent.service.env.backup.$(date +%Y%m%d_%H%M%S)
                        sudo sed -i "s/K3S_TOKEN=.*/K3S_TOKEN='${newToken}'/" /etc/systemd/system/k3s-agent.service.env
                    else
                        echo "K3S_TOKEN='${newToken}'" | sudo tee /etc/systemd/system/k3s-agent.service.env
                    fi

                    # If using systemd drop-in files
                    if [ -f /etc/systemd/system/k3s-agent.service.d/override.conf ]; then
                        sudo sed -i "s/K3S_TOKEN=.*/K3S_TOKEN='${newToken}'/" /etc/systemd/system/k3s-agent.service.d/override.conf
                    fi

                    # Also update environment variables if k3s-agent uses them
                    if sudo systemctl show k3s-agent | grep -q 'Environment=.*K3S_TOKEN'; then
                        sudo systemctl set-environment K3S_TOKEN='${newToken}'
                    fi

                    # Reload systemd and restart k3s-agent
                    sudo systemctl daemon-reload
                    sudo systemctl restart k3s-agent

                    # Wait for agent to reconnect
                    for i in {1..30}; do
                        if sudo systemctl is-active k3s-agent >/dev/null 2>&1; then
                            echo "Worker ${worker?.hostname || 'unknown'} reconnected successfully"
                            break
                        fi
                        echo "Waiting for worker to reconnect... ($i/30)"
                        sleep 10
                    done

                    # Verify agent is running
                    sudo systemctl status k3s-agent --no-pager
                `,
            }, { parent: this, dependsOn: [masterTokenUpdate] });

            workerUpdates.push(workerUpdate);
        }

        // Verify cluster health
        const clusterHealthCheck = new command.local.Command(`${name}-health-check`, {
            create: pulumi.interpolate`
                # Wait a bit for all nodes to stabilize
                sleep 30

                # Check cluster health
                export KUBECONFIG="${kubeconfigPath}"

                echo "Checking cluster health..."
                kubectl get nodes --no-headers > /tmp/node_status.txt

                # Count total and ready nodes
                TOTAL_NODES=$(wc -l < /tmp/node_status.txt)
                READY_NODES=$(grep -c " Ready" /tmp/node_status.txt || echo "0")

                echo "Cluster Status:"
                echo "  Total nodes: $TOTAL_NODES"
                echo "  Ready nodes: $READY_NODES"
                echo ""
                echo "Node Details:"
                kubectl get nodes

                if [ "$TOTAL_NODES" -eq "$READY_NODES" ] && [ "$READY_NODES" -gt 0 ]; then
                    echo ""
                    echo "✅ All nodes are healthy after token rotation"
                    echo "cluster_healthy=true"
                else
                    echo ""
                    echo "⚠️  Some nodes are not ready"
                    echo "cluster_healthy=false"
                fi

                # Clean up
                rm -f /tmp/node_status.txt
            `,
        }, { parent: this, dependsOn: workerUpdates });

        // Update ESC with new token and metadata
        const escUpdate = new command.local.Command(`${name}-esc-update`, {
            create: pulumi.interpolate`
                # Update ESC with new token and rotation metadata
                esc env set ${escEnvironment} "k3s.token" '${newToken}' --secret
                esc env set ${escEnvironment} "k3s.token_rotated_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --plaintext
                esc env set ${escEnvironment} "k3s.next_rotation" "$(date -u -d '+${rotationIntervalDays} days' +%Y-%m-%dT%H:%M:%SZ)" --plaintext
                esc env set ${escEnvironment} "k3s.rotation_interval_days" "${rotationIntervalDays}" --plaintext

                echo "ESC updated with new K3s token"
            `,
        }, { parent: this, dependsOn: [clusterHealthCheck] });

        // Update 1Password if configured
        const onePasswordUpdate = onePasswordItemId
            ? new command.local.Command(`${name}-1password-update`, {
                create: pulumi.interpolate`
                    # Update 1Password with new token and metadata
                    op item edit ${onePasswordItemId} --vault Infrastructure \
                        "k3s.token[text]=${newToken}" \
                        "k3s.token_rotated[text]=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                        "k3s.next_rotation[text]=$(date -u -d '+${rotationIntervalDays} days' +%Y-%m-%dT%H:%M:%SZ)" 2>/dev/null || \
                        echo "Warning: Could not update 1Password item ${onePasswordItemId}"

                    echo "1Password updated with new K3s token"
                `,
            }, { parent: this, dependsOn: [escUpdate] })
            : undefined;

        // Final dependency for all operations
        const finalDeps = onePasswordUpdate ? [onePasswordUpdate] : [escUpdate];

        // Create status outputs
        const tokenRotationStatus = pulumi.all([
            newToken,
            clusterHealthCheck.stdout,
            escUpdate.stdout
        ]).apply(([token, healthOutput, escOutput]) => ({
            lastRotation: new Date().toISOString(),
            nextRotation: new Date(Date.now() + rotationIntervalDays * 24 * 60 * 60 * 1000).toISOString(),
            tokenHash: `K10***${token.substring(token.length - 8)}`, // Mask token for security
            clusterHealthy: healthOutput.includes("cluster_healthy=true")
        }));

        const allNodesReady = clusterHealthCheck.stdout.apply(output =>
            output.includes("cluster_healthy=true")
        );

        this.outputs = {
            tokenRotationStatus,
            allNodesReady,
        };

        this.registerOutputs(this.outputs);
    }
}