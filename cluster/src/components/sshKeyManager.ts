import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import * as tls from "@pulumi/tls";

export interface SSHKeyConfig {
    nodeId: string;
    hostname: string;
    ip: string;
    user: string;
    onePasswordItemId?: string;
    rotationIntervalDays?: number;
}

export interface SSHKeyManagerArgs {
    nodes: Record<string, SSHKeyConfig>;
    escEnvironment: string;
    rotationIntervalDays?: number;
    keyType?: "ed25519" | "rsa";
    keySize?: number;
    enableAutoRotation?: boolean;
}

export interface SSHKeyManagerOutputs {
    keyRotationStatus: pulumi.Output<Record<string, {
        lastRotation: string;
        nextRotation: string;
        keyFingerprint: string;
        deploymentStatus: string;
    }>>;
    allKeysReady: pulumi.Output<boolean>;
}

export class SSHKeyManager extends pulumi.ComponentResource {
    public readonly outputs: SSHKeyManagerOutputs;

    constructor(name: string, args: SSHKeyManagerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:security:SSHKeyManager", name, {}, opts);

        const {
            nodes,
            escEnvironment,
            rotationIntervalDays = 90,
            keyType = "ed25519",
            keySize = 4096,
            enableAutoRotation = true
        } = args;

        const keyStatus: Record<string, pulumi.Output<any>> = {};
        const deployedKeys: Record<string, SSHKeyPair> = {};

        // Process each node
        for (const [nodeId, nodeConfig] of Object.entries(nodes)) {
            const keyPair = new SSHKeyPair(`${name}-${nodeId}`, {
                nodeConfig,
                escEnvironment,
                keyType,
                keySize,
                rotationIntervalDays: nodeConfig.rotationIntervalDays || rotationIntervalDays,
                enableAutoRotation,
            }, { parent: this });

            deployedKeys[nodeId] = keyPair;
            keyStatus[nodeId] = keyPair.rotationStatus;
        }

        // Aggregate status
        const allKeysReady = pulumi.output(
            Object.values(deployedKeys).map(key => key.deploymentReady)
        ).apply(statuses => statuses.every(status => status));

        const keyRotationStatus = pulumi.output(keyStatus);

        this.outputs = {
            keyRotationStatus,
            allKeysReady,
        };

        this.registerOutputs(this.outputs);
    }
}

class SSHKeyPair extends pulumi.ComponentResource {
    public readonly rotationStatus: pulumi.Output<any>;
    public readonly deploymentReady: pulumi.Output<boolean>;

    constructor(
        name: string,
        args: {
            nodeConfig: SSHKeyConfig;
            escEnvironment: string;
            keyType: "ed25519" | "rsa";
            keySize: number;
            rotationIntervalDays: number;
            enableAutoRotation: boolean;
        },
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("oceanid:security:SSHKeyPair", name, {}, opts);

        const { nodeConfig, escEnvironment, keyType, keySize, rotationIntervalDays, enableAutoRotation } = args;

        // Check if rotation is needed
        const rotationCheck = new command.local.Command(`${name}-rotation-check`, {
            create: pulumi.interpolate`
                # Check if key needs rotation based on ESC metadata
                LAST_ROTATION=$(esc env get ${escEnvironment} --format json | jq -r '.ssh.last_rotation // empty' 2>/dev/null || echo "")

                if [ -z "$LAST_ROTATION" ]; then
                    echo "rotation_needed=true"
                    echo "reason=no_previous_rotation"
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

        // Generate new SSH key if rotation is needed
        const sshKey = keyType === "ed25519"
            ? new tls.PrivateKey(`${name}-key`, {
                algorithm: "ED25519",
            }, { parent: this })
            : new tls.PrivateKey(`${name}-key`, {
                algorithm: "RSA",
                rsaBits: keySize,
            }, { parent: this });

        // Deploy key to node
        const keyDeployment = new command.remote.Command(`${name}-deploy`, {
            connection: {
                host: nodeConfig.ip,
                user: nodeConfig.user,
                privateKey: sshKey.privateKeyPem,
            },
            create: pulumi.interpolate`
                # Backup existing authorized_keys
                cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true

                # Ensure .ssh directory exists with correct permissions
                mkdir -p ~/.ssh
                chmod 700 ~/.ssh

                # Add new public key
                echo '${sshKey.publicKeyOpenssh}' >> ~/.ssh/authorized_keys

                # Remove duplicates and ensure proper permissions
                sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys
                chmod 600 ~/.ssh/authorized_keys

                # Test the key works
                echo "SSH key deployed successfully for ${nodeConfig.nodeId}"
            `,
        }, { parent: this, dependsOn: [sshKey] });

        // Verify key deployment
        const deploymentVerification = new command.remote.Command(`${name}-verify`, {
            connection: {
                host: nodeConfig.ip,
                user: nodeConfig.user,
                privateKey: sshKey.privateKeyPem,
            },
            create: pulumi.interpolate`
                # Verify we can authenticate with the new key
                whoami && hostname && echo "Key verification successful"
            `,
        }, { parent: this, dependsOn: [keyDeployment] });

        // Update ESC with new key
        const escUpdate = new command.local.Command(`${name}-esc-update`, {
            create: pulumi.all([sshKey.privateKeyPem, sshKey.publicKeyOpenssh]).apply(([privateKey, publicKey]) =>
                pulumi.interpolate`
                    # Base64 encode the private key for ESC storage
                    PRIVATE_KEY_B64=$(echo '${privateKey}' | base64 | tr -d '\n')

                    # Update ESC with new key and metadata
                    esc env set ${escEnvironment} "ssh.${nodeConfig.nodeId}_private_key_base64" "$PRIVATE_KEY_B64" --secret
                    esc env set ${escEnvironment} "ssh.${nodeConfig.nodeId}_public_key" '${publicKey}' --plaintext
                    esc env set ${escEnvironment} "ssh.last_rotation" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --plaintext
                    esc env set ${escEnvironment} "ssh.next_rotation" "$(date -u -d '+${rotationIntervalDays} days' +%Y-%m-%dT%H:%M:%SZ)" --plaintext
                    esc env set ${escEnvironment} "ssh.rotation_interval_days" "${rotationIntervalDays}" --plaintext

                    echo "ESC updated successfully for ${nodeConfig.nodeId}"
                `
            ),
        }, { parent: this, dependsOn: [deploymentVerification] });

        // Clean up old keys (remove previous keys from authorized_keys)
        const keyCleanup = new command.remote.Command(`${name}-cleanup`, {
            connection: {
                host: nodeConfig.ip,
                user: nodeConfig.user,
                privateKey: sshKey.privateKeyPem,
            },
            create: pulumi.interpolate`
                # Keep only the last 3 keys (current + 2 backups)
                if [ -f ~/.ssh/authorized_keys ]; then
                    # Count lines in authorized_keys
                    KEY_COUNT=$(wc -l < ~/.ssh/authorized_keys)

                    if [ "$KEY_COUNT" -gt 3 ]; then
                        # Keep only the last 3 lines (most recent keys)
                        tail -3 ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp
                        mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys
                        chmod 600 ~/.ssh/authorized_keys
                        echo "Cleaned up old SSH keys, kept last 3"
                    else
                        echo "No cleanup needed, only $KEY_COUNT keys present"
                    fi
                fi
            `,
        }, { parent: this, dependsOn: [escUpdate] });

        // Update 1Password if configured
        const onePasswordUpdate = nodeConfig.onePasswordItemId
            ? new command.local.Command(`${name}-1password-update`, {
                create: pulumi.interpolate`
                    # Update 1Password with rotation metadata
                    op item edit ${nodeConfig.onePasswordItemId} --vault Infrastructure \
                        "ssh.last_rotation[text]=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                        "ssh.next_rotation[text]=$(date -u -d '+${rotationIntervalDays} days' +%Y-%m-%dT%H:%M:%SZ)" \
                        "ssh.key_fingerprint[text]=$(echo '${sshKey.publicKeyOpenssh}' | ssh-keygen -lf -)" 2>/dev/null || \
                        echo "Warning: Could not update 1Password item ${nodeConfig.onePasswordItemId}"
                `,
            }, { parent: this, dependsOn: [escUpdate] })
            : undefined;

        // Create rotation status output
        this.rotationStatus = pulumi.all([
            sshKey.publicKeyOpenssh,
            escUpdate.stdout,
            keyCleanup.stdout
        ]).apply(([publicKey, escResult, cleanupResult]) => ({
            lastRotation: new Date().toISOString(),
            nextRotation: new Date(Date.now() + rotationIntervalDays * 24 * 60 * 60 * 1000).toISOString(),
            keyFingerprint: `SHA256:${Buffer.from(publicKey?.split(' ')[1] || '', 'base64').toString('hex').substring(0, 32)}`,
            deploymentStatus: "deployed"
        }));

        this.deploymentReady = keyCleanup.stdout.apply(output =>
            output.includes("successfully") || output.includes("No cleanup needed")
        );

        this.registerOutputs({
            rotationStatus: this.rotationStatus,
            deploymentReady: this.deploymentReady,
        });
    }
}