import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface SecurityHardeningArgs {
    k8sProvider: k8s.Provider;
    enableSSHHardening?: boolean;
    enablePasswordDisable?: boolean;
    enableFirewallConfig?: boolean;
    enableAuditLogging?: boolean;
    enableComplianceReporting?: boolean;
    nodeSelector?: Record<string, string>;
}

export interface SecurityHardeningOutputs {
    namespace: pulumi.Output<string>;
    hardeningStatus: pulumi.Output<{
        sshHardened: boolean;
        passwordAuthDisabled: boolean;
        firewallConfigured: boolean;
        auditLoggingEnabled: boolean;
        lastHardeningRun: string;
    }>;
    complianceReport: pulumi.Output<string>;
}

export class SecurityHardening extends pulumi.ComponentResource {
    public readonly outputs: SecurityHardeningOutputs;

    constructor(name: string, args: SecurityHardeningArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:security:SecurityHardening", name, {}, opts);

        const {
            k8sProvider,
            enableSSHHardening = true,
            enablePasswordDisable = true,
            enableFirewallConfig = true,
            enableAuditLogging = true,
            enableComplianceReporting = true,
            nodeSelector = {}
        } = args;

        const namespaceName = "security-hardening";

        // Create namespace
        const namespace = new k8s.core.v1.Namespace(`${name}-ns`, {
            metadata: {
                name: namespaceName,
                labels: {
                    "app.kubernetes.io/name": "security-hardening",
                    "app.kubernetes.io/component": "security",
                    "oceanid.cluster/component": "security",
                },
            },
        }, { provider: k8sProvider, parent: this });

        // Create ConfigMap with security hardening scripts
        const hardeningScripts = new k8s.core.v1.ConfigMap(`${name}-scripts`, {
            metadata: {
                name: "security-hardening-scripts",
                namespace: namespaceName,
                labels: {
                    "app.kubernetes.io/name": "security-hardening",
                },
            },
            data: {
                "ssh-hardening.sh": `#!/bin/bash
set -e

echo "🔒 Starting SSH Security Hardening..."

# Backup current SSH config
cp /host-etc/ssh/sshd_config /host-etc/ssh/sshd_config.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true

# Function to update SSH config setting
update_ssh_config() {
    local setting="$1"
    local value="$2"
    local config_file="/host-etc/ssh/sshd_config"

    if grep -q "^#*$setting" "$config_file"; then
        sed -i "s/^#*$setting.*/$setting $value/g" "$config_file"
    else
        echo "$setting $value" >> "$config_file"
    fi
}

# Disable password authentication
${enablePasswordDisable ? `
update_ssh_config "PasswordAuthentication" "no"
update_ssh_config "ChallengeResponseAuthentication" "no"
update_ssh_config "UsePAM" "no"
update_ssh_config "PermitRootLogin" "prohibit-password"
echo "✓ Password authentication disabled"
` : "echo 'Password authentication hardening skipped'"}

# Enable and configure key-only authentication
${enableSSHHardening ? `
update_ssh_config "PubkeyAuthentication" "yes"
update_ssh_config "AuthorizedKeysFile" ".ssh/authorized_keys"

# Additional security settings
update_ssh_config "MaxAuthTries" "3"
update_ssh_config "MaxSessions" "10"
update_ssh_config "ClientAliveInterval" "300"
update_ssh_config "ClientAliveCountMax" "2"
update_ssh_config "LoginGraceTime" "60"
update_ssh_config "X11Forwarding" "no"
update_ssh_config "AllowTcpForwarding" "no"
update_ssh_config "AllowAgentForwarding" "no"
update_ssh_config "PermitTunnel" "no"
update_ssh_config "PermitUserEnvironment" "no"

# Protocol and crypto hardening
update_ssh_config "Protocol" "2"
update_ssh_config "HostKeyAlgorithms" "ssh-ed25519,ssh-ed25519-cert-v01@openssh.com,sk-ssh-ed25519@openssh.com,sk-ssh-ed25519-cert-v01@openssh.com,rsa-sha2-256,rsa-sha2-512"
update_ssh_config "KexAlgorithms" "curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512"
update_ssh_config "Ciphers" "chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr"
update_ssh_config "MACs" "hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com,umac-128-etm@openssh.com"

echo "✓ SSH security hardening applied"
` : "echo 'SSH hardening skipped'"}

# Validate SSH config
if chroot /host-root sshd -t; then
    echo "✓ SSH configuration is valid"

    # Signal SSH daemon to reload
    if chroot /host-root systemctl is-active sshd >/dev/null 2>&1; then
        chroot /host-root systemctl reload sshd
    elif chroot /host-root systemctl is-active ssh >/dev/null 2>&1; then
        chroot /host-root systemctl reload ssh
    else
        echo "⚠️  Could not reload SSH daemon"
    fi
else
    echo "❌ SSH configuration validation failed"
    exit 1
fi

echo "✅ SSH hardening completed successfully"
`,

                "firewall-config.sh": `#!/bin/bash
set -e

echo "🔥 Configuring Host Firewall..."

${enableFirewallConfig ? `
# Configure UFW firewall rules
chroot /host-root bash << 'EOF'
# Reset UFW to defaults
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing
ufw default deny forward

# Essential services
ufw allow 22/tcp comment 'SSH'
ufw allow 6443/tcp comment 'Kubernetes API'
ufw allow 10250/tcp comment 'Kubelet API'
ufw allow 2379:2380/tcp comment 'etcd'
ufw allow 30000:32767/tcp comment 'NodePort Services'
ufw allow 51820:51821/udp comment 'Flannel VXLAN/Wireguard'

# Enable firewall
ufw --force enable

# Show status
ufw status verbose
EOF

echo "✓ Firewall configured"
` : "echo 'Firewall configuration skipped'"}

echo "✅ Firewall configuration completed"
`,

                "audit-setup.sh": `#!/bin/bash
set -e

echo "📋 Setting up Security Audit Logging..."

${enableAuditLogging ? `
# Configure auditd
chroot /host-root bash << 'EOF'
# Install auditd if not present
if ! command -v auditctl >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update && apt-get install -y auditd
    elif command -v yum >/dev/null 2>&1; then
        yum install -y audit
    fi
fi

# Basic audit rules for security monitoring
cat > /etc/audit/rules.d/oceanid-security.rules << 'RULES'
# Monitor SSH access
-w /var/log/auth.log -p wa -k ssh_access
-w /etc/ssh/sshd_config -p wa -k ssh_config

# Monitor user account modifications
-w /etc/passwd -p wa -k account_modification
-w /etc/group -p wa -k account_modification
-w /etc/shadow -p wa -k account_modification

# Monitor sudo usage
-w /etc/sudoers -p wa -k sudo_config
-w /var/log/sudo.log -p wa -k sudo_usage

# Monitor K3s files
-w /var/lib/rancher/k3s/server/token -p wa -k k3s_token
-w /etc/rancher/k3s/ -p wa -k k3s_config

# Monitor critical system files
-w /etc/hosts -p wa -k network_config
-w /etc/crontab -p wa -k cron_config
RULES

# Restart auditd
systemctl enable auditd
systemctl restart auditd || systemctl start auditd

echo "✓ Audit logging configured"
EOF
` : "echo 'Audit logging setup skipped'"}

echo "✅ Audit logging setup completed"
`,

                "compliance-check.sh": `#!/bin/bash
set -e

echo "🎯 Running Security Compliance Check..."

COMPLIANCE_REPORT="/tmp/compliance-report.json"

# Initialize report
cat > "$COMPLIANCE_REPORT" << 'EOF'
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "node": "$(hostname)",
  "checks": {},
  "summary": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "score": 0
  }
}
EOF

# Function to add check result
add_check() {
    local name="$1"
    local status="$2"
    local description="$3"

    jq --arg name "$name" --arg status "$status" --arg desc "$description" \
       '.checks[$name] = {"status": $status, "description": $desc}' \
       "$COMPLIANCE_REPORT" > "$COMPLIANCE_REPORT.tmp" && mv "$COMPLIANCE_REPORT.tmp" "$COMPLIANCE_REPORT"
}

# SSH Security Checks
echo "Checking SSH security..."

if grep -q "^PasswordAuthentication no" /host-etc/ssh/sshd_config 2>/dev/null; then
    add_check "ssh_password_disabled" "PASS" "Password authentication is disabled"
else
    add_check "ssh_password_disabled" "FAIL" "Password authentication is not disabled"
fi

if grep -q "^PermitRootLogin prohibit-password" /host-etc/ssh/sshd_config 2>/dev/null; then
    add_check "ssh_root_login_secured" "PASS" "Root login is secured (key-only)"
else
    add_check "ssh_root_login_secured" "FAIL" "Root login is not properly secured"
fi

# Firewall Checks
if chroot /host-root ufw status | grep -q "Status: active" 2>/dev/null; then
    add_check "firewall_enabled" "PASS" "UFW firewall is active"
else
    add_check "firewall_enabled" "FAIL" "UFW firewall is not active"
fi

# Audit Checks
if chroot /host-root systemctl is-active auditd >/dev/null 2>&1; then
    add_check "audit_logging" "PASS" "Audit logging is active"
else
    add_check "audit_logging" "FAIL" "Audit logging is not active"
fi

# Calculate summary
TOTAL_CHECKS=$(jq '.checks | length' "$COMPLIANCE_REPORT")
PASSED_CHECKS=$(jq '[.checks[] | select(.status == "PASS")] | length' "$COMPLIANCE_REPORT")
FAILED_CHECKS=$(jq '[.checks[] | select(.status == "FAIL")] | length' "$COMPLIANCE_REPORT")
SCORE=$(echo "scale=2; $PASSED_CHECKS / $TOTAL_CHECKS * 100" | bc 2>/dev/null || echo "0")

# Update summary
jq --argjson total "$TOTAL_CHECKS" --argjson passed "$PASSED_CHECKS" --argjson failed "$FAILED_CHECKS" --arg score "$SCORE%" \
   '.summary = {"total": $total, "passed": $passed, "failed": $failed, "score": $score}' \
   "$COMPLIANCE_REPORT" > "$COMPLIANCE_REPORT.tmp" && mv "$COMPLIANCE_REPORT.tmp" "$COMPLIANCE_REPORT"

echo "✅ Compliance check completed"
echo "Score: $SCORE% ($PASSED_CHECKS/$TOTAL_CHECKS checks passed)"

# Output report for collection
cat "$COMPLIANCE_REPORT"
`,

                "main-hardening.sh": `#!/bin/bash
set -e

echo "🛡️  Starting Security Hardening Process..."
echo "============================================"

# Run all hardening scripts
/scripts/ssh-hardening.sh
/scripts/firewall-config.sh
/scripts/audit-setup.sh

# Run compliance check
echo ""
echo "📊 Running final compliance check..."
/scripts/compliance-check.sh > /shared/compliance-report.json

echo ""
echo "✅ Security hardening completed successfully!"
echo "Report available at: /shared/compliance-report.json"
`
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [namespace] });

        // Create DaemonSet for security hardening
        const hardeningDaemonSet = new k8s.apps.v1.DaemonSet(`${name}-daemonset`, {
            metadata: {
                name: "security-hardening",
                namespace: namespaceName,
                labels: {
                    "app.kubernetes.io/name": "security-hardening",
                    "app.kubernetes.io/component": "security",
                },
            },
            spec: {
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "security-hardening",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "security-hardening",
                            "app.kubernetes.io/component": "security",
                        },
                    },
                    spec: {
                        nodeSelector: nodeSelector,
                        tolerations: [
                            {
                                operator: "Exists",
                                effect: "NoSchedule",
                            },
                            {
                                operator: "Exists",
                                effect: "NoExecute",
                            },
                        ],
                        hostNetwork: true,
                        hostPID: true,
                        containers: [
                            {
                                name: "security-hardening",
                                image: "alpine:3.19",
                                command: ["/bin/sh"],
                                args: ["-c", `
                                    # Install required packages
                                    apk add --no-cache bash jq bc

                                    # Make scripts executable
                                    chmod +x /scripts/*.sh

                                    # Run main hardening script
                                    /scripts/main-hardening.sh

                                    # Keep container running for monitoring
                                    while true; do
                                        echo "Security hardening monitoring active..."
                                        sleep 3600
                                    done
                                `],
                                securityContext: {
                                    privileged: true,
                                    runAsUser: 0,
                                },
                                volumeMounts: [
                                    {
                                        name: "scripts",
                                        mountPath: "/scripts",
                                        readOnly: true,
                                    },
                                    {
                                        name: "host-etc",
                                        mountPath: "/host-etc",
                                    },
                                    {
                                        name: "host-root",
                                        mountPath: "/host-root",
                                    },
                                    {
                                        name: "shared",
                                        mountPath: "/shared",
                                    },
                                ],
                                env: [
                                    {
                                        name: "NODE_NAME",
                                        valueFrom: {
                                            fieldRef: {
                                                fieldPath: "spec.nodeName",
                                            },
                                        },
                                    },
                                ],
                                resources: {
                                    requests: {
                                        cpu: "100m",
                                        memory: "128Mi",
                                    },
                                    limits: {
                                        cpu: "500m",
                                        memory: "512Mi",
                                    },
                                },
                            },
                        ],
                        volumes: [
                            {
                                name: "scripts",
                                configMap: {
                                    name: hardeningScripts.metadata.name,
                                    defaultMode: 0o755,
                                },
                            },
                            {
                                name: "host-etc",
                                hostPath: {
                                    path: "/etc",
                                },
                            },
                            {
                                name: "host-root",
                                hostPath: {
                                    path: "/",
                                },
                            },
                            {
                                name: "shared",
                                emptyDir: {},
                            },
                        ],
                        restartPolicy: "Always",
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [hardeningScripts] });

        // Create Service for monitoring
        const monitoringService = new k8s.core.v1.Service(`${name}-monitor`, {
            metadata: {
                name: "security-hardening-monitor",
                namespace: namespaceName,
                labels: {
                    "app.kubernetes.io/name": "security-hardening",
                },
            },
            spec: {
                selector: {
                    "app.kubernetes.io/name": "security-hardening",
                },
                ports: [
                    {
                        name: "monitoring",
                        port: 8080,
                        targetPort: 8080,
                    },
                ],
                type: "ClusterIP",
            },
        }, { provider: k8sProvider, parent: this });

        // Create outputs
        const hardeningStatus = pulumi.output({
            sshHardened: enableSSHHardening,
            passwordAuthDisabled: enablePasswordDisable,
            firewallConfigured: enableFirewallConfig,
            auditLoggingEnabled: enableAuditLogging,
            lastHardeningRun: new Date().toISOString(),
        });

        const complianceReport = pulumi.interpolate`Security Hardening Deployed: ${namespaceName}`;

        this.outputs = {
            namespace: namespace.metadata.name,
            hardeningStatus,
            complianceReport,
        };

        this.registerOutputs(this.outputs);
    }
}
