import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

export interface NodeConfig {
    hostname: string;
    ip: string;
    role: "master" | "worker";
    gpu?: string;
    labels?: Record<string, string>;
}

export interface K3sClusterArgs {
    nodes: Record<string, NodeConfig>;
    k3sToken: pulumi.Input<string>;
    k3sVersion?: string;
    privateKeys: Record<string, pulumi.Input<string>>;
    enableEtcdBackups?: boolean;
    backupS3Bucket?: string;
    s3Credentials?: {
        accessKey: pulumi.Input<string>;
        secretKey: pulumi.Input<string>;
        region?: string;
        endpoint?: string;
    };
}

export interface K3sClusterOutputs {
    provisioningStatus: pulumi.Output<Record<string, boolean>>;
    masterEndpoint: pulumi.Output<string>;
    clusterReady: pulumi.Output<boolean>;
}

export class K3sNode extends pulumi.ComponentResource {
    public readonly nodeReady: pulumi.Output<boolean>;
    public readonly nodeHostname: pulumi.Output<string>;

    constructor(
        name: string,
        args: {
            config: NodeConfig;
            privateKey: pulumi.Input<string>;
            k3sToken: pulumi.Input<string>;
            k3sServerUrl?: pulumi.Input<string>;
            k3sVersion?: string;
            enableEtcdBackups?: boolean;
            backupS3Bucket?: string;
            s3Credentials?: {
                accessKey: pulumi.Input<string>;
                secretKey: pulumi.Input<string>;
                region?: string;
                endpoint?: string;
            };
        },
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("oceanid:infrastructure:K3sNode", name, {}, opts);

        const { config: nodeConfig, privateKey, k3sToken, k3sServerUrl, k3sVersion = "v1.33.4+k3s1" } = args;

        // Step 1: System preparation and hardening
        const systemPrep = new command.remote.Command(`${name}-system-prep`, {
            connection: {
                host: nodeConfig.ip,
                user: "root",
                privateKey: privateKey,
            },
            create: pulumi.interpolate`
                # Detect OS type
                if [ -f /etc/alpine-release ]; then
                    OS_TYPE="alpine"
                    PKG_MANAGER="apk"
                elif [ -f /etc/debian_version ] || [ -f /etc/lsb-release ]; then
                    OS_TYPE="debian"
                    PKG_MANAGER="apt"
                else
                    echo "Unsupported OS"
                    exit 1
                fi

                echo "Detected OS: $OS_TYPE"

                # Update system packages
                if [ "$OS_TYPE" = "alpine" ]; then
                    apk update && apk upgrade
                    # Install essential packages
                    apk add curl wget git htop iotop nfs-utils iptables ip6tables
                else
                    apt-get update && apt-get upgrade -y
                    # Configure locale (Ubuntu only)
                    locale-gen en_US.UTF-8
                    update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
                    # Install essential packages
                    apt-get install -y curl wget git htop iotop nfs-common
                fi

                # Configure firewall for k3s
                if [ "$OS_TYPE" = "alpine" ]; then
                    # Alpine: Use iptables directly (no ufw)
                    # Save rules to /etc/iptables/rules-save for persistence
                    mkdir -p /etc/iptables

                    # Allow established connections
                    iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
                    ip6tables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

                    # Allow loopback
                    iptables -A INPUT -i lo -j ACCEPT
                    ip6tables -A INPUT -i lo -j ACCEPT

                    # Allow K3s ports
                    iptables -A INPUT -p tcp --dport 22 -j ACCEPT
                    iptables -A INPUT -p tcp --dport 6443 -j ACCEPT
                    iptables -A INPUT -p tcp --dport 10250 -j ACCEPT
                    iptables -A INPUT -p tcp --dport 2379:2380 -j ACCEPT
                    iptables -A INPUT -p tcp --dport 30000:32767 -j ACCEPT
                    iptables -A INPUT -p udp --dport 51820:51821 -j ACCEPT
                    ip6tables -A INPUT -p tcp --dport 22 -j ACCEPT
                    ip6tables -A INPUT -p tcp --dport 6443 -j ACCEPT

                    # Drop other incoming by default (but allow outgoing)
                    iptables -A INPUT -j DROP
                    ip6tables -A INPUT -j DROP

                    # Save rules
                    iptables-save > /etc/iptables/rules-save
                    ip6tables-save > /etc/iptables/rules6-save

                    # Enable iptables service to load rules on boot
                    rc-update add iptables default
                    rc-update add ip6tables default
                else
                    # Ubuntu: Use ufw
                    ufw allow 22/tcp
                    ufw allow 6443/tcp
                    ufw allow 10250/tcp
                    ufw allow 2379:2380/tcp
                    ufw allow 30000:32767/tcp
                    ufw allow 51820:51821/udp
                    ufw --force enable
                fi

                # Kernel parameter optimization for k3s
                cat >> /etc/sysctl.conf << 'EOF'
net.ipv4.ip_forward=1
net.bridge.bridge-nf-call-iptables=1
net.bridge.bridge-nf-call-ip6tables=1
EOF
                sysctl -p

                # Create k3s directories
                mkdir -p /etc/rancher/k3s /var/lib/rancher/k3s/server/tls

                echo "System preparation completed for $OS_TYPE"
            `,
        }, { parent: this, customTimeouts: { create: "30m", update: "30m" } });

        // Step 2: Install k3s with proper configuration
        const isPrimaryMaster = nodeConfig.role === "master" &&
            nodeConfig.labels?.["oceanid.cluster/control-plane"] === "primary";
        const isSecondaryMaster = nodeConfig.role === "master" &&
            nodeConfig.labels?.["oceanid.cluster/control-plane"] === "secondary";

        const k3sInstallArgs = isPrimaryMaster
            ? pulumi.interpolate`--cluster-init --disable=traefik --disable=servicelb`
            : isSecondaryMaster
            ? pulumi.interpolate`--server ${k3sServerUrl} --disable=traefik --disable=servicelb`
            : pulumi.interpolate`--server ${k3sServerUrl}`;

        const labelArgs = nodeConfig.labels
            ? Object.entries(nodeConfig.labels).map(([k, v]) => `--node-label ${k}=${v}`).join(" ")
            : "";

        // Configure etcd backups for all master nodes
        const etcdBackupConfig = args.enableEtcdBackups && nodeConfig.role === "master" && args.backupS3Bucket
            ? args.s3Credentials
                ? pulumi.interpolate`--etcd-snapshot-schedule-cron="0 2 * * *" --etcd-snapshot-retention=7 --etcd-s3 --etcd-s3-bucket=${args.backupS3Bucket} --etcd-s3-region=${args.s3Credentials.region || "us-east-1"} ${args.s3Credentials.endpoint ? `--etcd-s3-endpoint=${args.s3Credentials.endpoint}` : ""}`
                : pulumi.interpolate`--etcd-snapshot-schedule-cron="0 2 * * *" --etcd-snapshot-retention=7`
            : "";

        const installK3s = new command.remote.Command(`${name}-install-k3s`, {
            connection: {
                host: nodeConfig.ip,
                user: "root",
                privateKey: privateKey,
            },
            create: pulumi.interpolate`
                # Detect OS for service checks
                if [ -f /etc/alpine-release ]; then
                    K3S_CHECK="rc-service k3s status 2>/dev/null | grep -q started || rc-service k3s-agent status 2>/dev/null | grep -q started"
                    K3S_AGENT_CHECK="rc-service k3s-agent status | grep -q started"
                else
                    K3S_CHECK="systemctl is-active --quiet k3s || systemctl is-active --quiet k3s-agent"
                    K3S_AGENT_CHECK="systemctl is-active --quiet k3s-agent"
                fi

                # Check if k3s is already installed and running
                if eval "$K3S_CHECK"; then
                    echo "k3s already installed and running"
                    exit 0
                fi

                # Install k3s with specified version
                export INSTALL_K3S_VERSION=${k3sVersion}
                export K3S_TOKEN=${k3sToken}

                # Set S3 credentials if provided
                ${args.s3Credentials ? pulumi.interpolate`
                export AWS_ACCESS_KEY_ID="${args.s3Credentials.accessKey}"
                export AWS_SECRET_ACCESS_KEY="${args.s3Credentials.secretKey}"
                ` : ""}

                # Install based on role
                if [ "${nodeConfig.role}" = "master" ]; then
                    curl -sfL https://get.k3s.io | sh -s - server ${k3sInstallArgs} ${etcdBackupConfig} ${labelArgs}
                else
                    curl -sfL https://get.k3s.io | sh -s - agent ${k3sInstallArgs} ${labelArgs}
                fi

                # Wait for k3s to be ready
                sleep 15

                # Verify installation
                if [ "${nodeConfig.role}" = "master" ]; then
                    /usr/local/bin/k3s kubectl get nodes --no-headers | grep -q Ready
                else
                    eval "$K3S_AGENT_CHECK"
                fi

                echo "k3s installation completed successfully"
            `,
        }, { parent: this, dependsOn: [systemPrep], customTimeouts: { create: "45m", update: "45m" } });

        // Step 3: Configure node-specific settings
        const nodeSpecificConfig = new command.remote.Command(`${name}-configure`, {
            connection: {
                host: nodeConfig.ip,
                user: "root",
                privateKey: privateKey,
            },
            create: pulumi.interpolate`
                # GPU node specific configuration
                if [ "${nodeConfig.gpu || ""}" != "" ]; then
                    # Detect OS for GPU setup
                    if [ -f /etc/alpine-release ]; then
                        OS_TYPE="alpine"
                    else
                        OS_TYPE="debian"
                    fi

                    # Install nvidia container runtime if not present
                    if ! command -v nvidia-container-runtime >/dev/null 2>&1; then
                        if [ "$OS_TYPE" = "alpine" ]; then
                            # Alpine: Install from community repo
                            apk add nvidia-container-toolkit
                        else
                            # Ubuntu/Debian: Use nvidia-docker repo
                            distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
                            curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | apt-key add -
                            curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | tee /etc/apt/sources.list.d/nvidia-docker.list
                            apt-get update && apt-get install -y nvidia-container-runtime
                        fi

                        # Configure containerd for GPU (same for both OSes)
                        mkdir -p /var/lib/rancher/k3s/agent/etc/containerd/
                        cat > /var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl << EOF
[plugins.opt]
  path = "/opt/containerd"
[plugins.cri]
  stream_server_address = "127.0.0.1"
  stream_server_port = "10010"
[plugins.cri.containerd.default_runtime]
  runtime_type = "io.containerd.runc.v2"
[plugins.cri.containerd.runtimes.runc]
  runtime_type = "io.containerd.runc.v2"
[plugins.cri.containerd.runtimes.nvidia]
  runtime_type = "io.containerd.runc.v2"
[plugins.cri.containerd.runtimes.nvidia.options]
  BinaryName = "/usr/bin/nvidia-container-runtime"
EOF
                        # Restart k3s service (OS-specific)
                        if [ "$OS_TYPE" = "alpine" ]; then
                            rc-service k3s-agent restart || rc-service k3s restart
                        else
                            systemctl restart k3s-agent || systemctl restart k3s
                        fi
                    fi
                fi

                # Configure log rotation
                # Detect OS for service reload command
                if [ -f /etc/alpine-release ]; then
                    SERVICE_RELOAD="rc-service k3s reload 2>/dev/null || rc-service k3s-agent reload 2>/dev/null || true"
                else
                    SERVICE_RELOAD="systemctl reload k3s 2>/dev/null || systemctl reload k3s-agent 2>/dev/null || true"
                fi

                cat > /etc/logrotate.d/k3s << EOF
/var/log/k3s.log {
    daily
    missingok
    rotate 7
    compress
    notifempty
    create 0644 root root
    postrotate
        $SERVICE_RELOAD
    endscript
}
EOF

                echo "Node-specific configuration completed"
            `,
        }, { parent: this, dependsOn: [installK3s], customTimeouts: { create: "30m", update: "30m" } });

        // Step 4: Health verification
        const healthCheck = new command.remote.Command(`${name}-health-check`, {
            connection: {
                host: nodeConfig.ip,
                user: "root",
                privateKey: privateKey,
            },
            create: pulumi.interpolate`
                # Detect OS for service checks
                if [ -f /etc/alpine-release ]; then
                    SERVICE_CHECK="rc-service k3s-agent status | grep -q started"
                    SERVICE_ACTIVE_CHECK="rc-service k3s-agent status | grep -q started"
                else
                    SERVICE_CHECK="systemctl is-active --quiet k3s-agent"
                    SERVICE_ACTIVE_CHECK="systemctl is-active k3s-agent"
                fi

                # Wait for node to be ready
                for i in {1..30}; do
                    if [ "${nodeConfig.role}" = "master" ]; then
                        if /usr/local/bin/k3s kubectl get nodes ${nodeConfig.hostname} --no-headers 2>/dev/null | grep -q Ready; then
                            echo "Master node is ready"
                            break
                        fi
                    else
                        if eval "$SERVICE_CHECK"; then
                            echo "Worker node is ready"
                            break
                        fi
                    fi
                    echo "Waiting for node to be ready... (attempt $i/30)"
                    sleep 10
                done

                # Final health check
                if [ "${nodeConfig.role}" = "master" ]; then
                    /usr/local/bin/k3s kubectl get nodes ${nodeConfig.hostname} --no-headers | grep Ready
                else
                    eval "$SERVICE_ACTIVE_CHECK"
                fi
            `,
        }, { parent: this, dependsOn: [nodeSpecificConfig], customTimeouts: { create: "15m", update: "15m" } });

        this.nodeReady = healthCheck.stdout.apply(output =>
            output.includes("Ready") || output.includes("active") || output.includes("started")
        );
        this.nodeHostname = pulumi.output(nodeConfig.hostname);

        this.registerOutputs({
            nodeReady: this.nodeReady,
            nodeHostname: this.nodeHostname,
        });
    }
}

export class K3sCluster extends pulumi.ComponentResource {
    public readonly outputs: K3sClusterOutputs;

    constructor(name: string, args: K3sClusterArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:infrastructure:K3sCluster", name, {}, opts);

        const { nodes, k3sToken, k3sVersion, privateKeys, enableEtcdBackups, backupS3Bucket, s3Credentials } = args;

        // Find master nodes
        const masterNodes = Object.entries(nodes).filter(([_, config]) => config.role === "master");
        if (masterNodes.length === 0) {
            throw new Error("No master node found in configuration");
        }

        // Find primary master node
        const primaryMaster = masterNodes.find(([_, config]) =>
            config.labels?.["oceanid.cluster/control-plane"] === "primary"
        );
        if (!primaryMaster) {
            throw new Error("No primary master node found in configuration");
        }

        const [primaryMasterName, primaryMasterConfig] = primaryMaster;
        const masterServerUrl = pulumi.interpolate`https://${primaryMasterConfig.ip}:6443`;

        // Create primary master node first
        const primaryPrivateKey = privateKeys[primaryMasterName];
        if (!primaryPrivateKey) {
            throw new Error(`Private key not found for primary master: ${primaryMasterName}`);
        }

        const primary = new K3sNode(primaryMasterName, {
            config: primaryMasterConfig,
            privateKey: primaryPrivateKey,
            k3sToken,
            k3sVersion,
            enableEtcdBackups,
            backupS3Bucket,
            s3Credentials,
        }, { parent: this });

        // Create secondary master nodes
        const secondaryMasters: Record<string, K3sNode> = {};
        for (const [nodeName, nodeConfig] of masterNodes) {
            if (nodeConfig.labels?.["oceanid.cluster/control-plane"] === "secondary") {
                const nodePrivateKey = privateKeys[nodeName];
                if (!nodePrivateKey) {
                    throw new Error(`Private key not found for secondary master: ${nodeName}`);
                }

                secondaryMasters[nodeName] = new K3sNode(nodeName, {
                    config: nodeConfig,
                    privateKey: nodePrivateKey,
                    k3sToken,
                    k3sServerUrl: masterServerUrl,
                    k3sVersion,
                    enableEtcdBackups,
                    backupS3Bucket,
                    s3Credentials,
                }, { parent: this, dependsOn: [primary] });
            }
        }

        // Create worker nodes
        const workers: Record<string, K3sNode> = {};
        const allMasters = [primary, ...Object.values(secondaryMasters)];
        for (const [nodeName, nodeConfig] of Object.entries(nodes)) {
            if (nodeConfig.role === "worker") {
                const workerPrivateKey = privateKeys[nodeName];
                if (!workerPrivateKey) {
                    throw new Error(`Private key not found for worker: ${nodeName}`);
                }

                workers[nodeName] = new K3sNode(nodeName, {
                    config: nodeConfig,
                    privateKey: workerPrivateKey,
                    k3sToken,
                    k3sServerUrl: masterServerUrl,
                    k3sVersion,
                    enableEtcdBackups: false, // Workers don't need etcd backups
                    backupS3Bucket: undefined,
                    s3Credentials: undefined,
                }, { parent: this, dependsOn: allMasters });
            }
        }

        // Aggregate outputs
        const allNodes = { [primaryMasterName]: primary, ...secondaryMasters, ...workers };
        const provisioningStatus = pulumi.output(
            Object.fromEntries(
                Object.entries(allNodes).map(([name, node]) => [name, node.nodeReady])
            )
        );

        const clusterReady = pulumi.output(
            Object.values(allNodes).map(node => node.nodeReady)
        ).apply(statuses => statuses.every(status => status));

        this.outputs = {
            provisioningStatus,
            masterEndpoint: masterServerUrl,
            clusterReady,
        };

        this.registerOutputs(this.outputs);
    }
}
