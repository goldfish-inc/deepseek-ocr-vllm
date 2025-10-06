import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as command from "@pulumi/command";

export interface CredentialSyncTarget {
    name: string;
    type: "1password" | "esc" | "k8s-secret";
    configuration: {
        vault?: string;
        itemId?: string;
        environment?: string;
        namespace?: string;
        secretName?: string;
    };
}

export interface CredentialSynchronizerArgs {
    k8sProvider?: k8s.Provider;
    escEnvironment: string;
    syncTargets: CredentialSyncTarget[];
    syncIntervalMinutes?: number;
    enableBidirectionalSync?: boolean;
    enableValidation?: boolean;
    credentialMappings: Record<string, {
        source: string;
        targets: string[];
        validation?: {
            format?: "k3s-token" | "ssh-key" | "api-token";
            required?: boolean;
        };
    }>;
}

export interface CredentialSynchronizerOutputs {
    namespace: pulumi.Output<string>;
    syncStatus: pulumi.Output<Record<string, {
        lastSync: string;
        status: "success" | "failed" | "pending";
        errors?: string[];
    }>>;
    validationResults: pulumi.Output<Record<string, boolean>>;
    allCredentialsValid: pulumi.Output<boolean>;
}

export class CredentialSynchronizer extends pulumi.ComponentResource {
    public readonly outputs: CredentialSynchronizerOutputs;

    constructor(name: string, args: CredentialSynchronizerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:security:CredentialSynchronizer", name, {}, opts);

        const {
            k8sProvider,
            escEnvironment,
            syncTargets,
            syncIntervalMinutes = 60,
            enableBidirectionalSync = false,
            enableValidation = true,
            credentialMappings
        } = args;

        const namespaceName = "credential-sync";

        // Create namespace if k8s provider is available
        const namespace = k8sProvider
            ? new k8s.core.v1.Namespace(`${name}-ns`, {
                metadata: {
                    name: namespaceName,
                    labels: {
                        "app.kubernetes.io/name": "credential-synchronizer",
                        "app.kubernetes.io/component": "security",
                        "oceanid.cluster/component": "security",
                    },
                },
            }, { provider: k8sProvider, parent: this })
            : undefined;

        // Create sync configuration
        const syncConfig = k8sProvider
            ? new k8s.core.v1.ConfigMap(`${name}-config`, {
                metadata: {
                    name: "credential-sync-config",
                    namespace: namespaceName,
                    labels: {
                        "app.kubernetes.io/name": "credential-synchronizer",
                    },
                },
                data: {
                    "config.json": JSON.stringify({
                        escEnvironment,
                        syncTargets,
                        syncIntervalMinutes,
                        enableBidirectionalSync,
                        enableValidation,
                        credentialMappings,
                    }, null, 2),
                    "sync-script.sh": this.generateSyncScript(args),
                    "validate-script.sh": this.generateValidationScript(args),
                },
            }, { provider: k8sProvider, parent: this, dependsOn: namespace ? [namespace] : undefined })
            : undefined;

        // Create CronJob for periodic synchronization
        const syncCronJob = k8sProvider
            ? new k8s.batch.v1.CronJob(`${name}-cronjob`, {
                metadata: {
                    name: "credential-sync",
                    namespace: namespaceName,
                    labels: {
                        "app.kubernetes.io/name": "credential-synchronizer",
                    },
                },
                spec: {
                    schedule: `*/${syncIntervalMinutes} * * * *`,
                    concurrencyPolicy: "Forbid",
                    successfulJobsHistoryLimit: 3,
                    failedJobsHistoryLimit: 5,
                    jobTemplate: {
                        spec: {
                            template: {
                                metadata: {
                                    labels: {
                                        "app.kubernetes.io/name": "credential-synchronizer",
                                    },
                                },
                                spec: {
                                    restartPolicy: "OnFailure",
                                    containers: [
                                        {
                                            name: "credential-sync",
                                            image: "alpine:3.19",
                                            command: ["/bin/sh"],
                                            args: ["-c", `
                                                # Install required packages
                                                apk add --no-cache bash curl jq

                                                # Install 1Password CLI
                                                curl -sSfL https://cache.agilebits.com/dist/1P/op2/pkg/v2.21.0/op_linux_amd64_v2.21.0.tar.gz | tar -xz -C /usr/local/bin op

                                                # Install Pulumi ESC CLI
                                                curl -fsSL https://get.pulumi.com/esc/install.sh | sh
                                                export PATH=$PATH:/root/.pulumi/bin

                                                # Make scripts executable
                                                chmod +x /config/sync-script.sh
                                                chmod +x /config/validate-script.sh

                                                # Run credential sync
                                                echo "Starting credential synchronization..."
                                                /config/sync-script.sh

                                                # Run validation
                                                echo "Running credential validation..."
                                                /config/validate-script.sh

                                                echo "Credential sync and validation completed"
                                            `],
                                            env: [
                                                {
                                                    name: "OP_SERVICE_ACCOUNT_TOKEN",
                                                    valueFrom: {
                                                        secretKeyRef: {
                                                            name: "onepassword-token",
                                                            key: "token",
                                                            optional: true,
                                                        },
                                                    },
                                                },
                                                {
                                                    name: "PULUMI_ACCESS_TOKEN",
                                                    valueFrom: {
                                                        secretKeyRef: {
                                                            name: "pulumi-credentials",
                                                            key: "accessToken",
                                                            optional: true,
                                                        },
                                                    },
                                                },
                                            ],
                                            volumeMounts: [
                                                {
                                                    name: "config",
                                                    mountPath: "/config",
                                                    readOnly: true,
                                                },
                                                {
                                                    name: "sync-results",
                                                    mountPath: "/results",
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
                                            securityContext: {
                                                runAsNonRoot: true,
                                                runAsUser: 1000,
                                                allowPrivilegeEscalation: false,
                                                readOnlyRootFilesystem: true,
                                                capabilities: {
                                                    drop: ["ALL"],
                                                },
                                            },
                                        },
                                    ],
                                    volumes: [
                                        {
                                            name: "config",
                                            configMap: {
                                                name: syncConfig?.metadata.name,
                                                defaultMode: 0o755,
                                            },
                                        },
                                        {
                                            name: "sync-results",
                                            emptyDir: {},
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            }, { provider: k8sProvider, parent: this, dependsOn: syncConfig ? [syncConfig] : undefined })
            : undefined;

        // Manual sync trigger (one-time job)
        const manualSync = new command.local.Command(`${name}-manual-sync`, {
            create: this.generateSyncScript(args),
        }, { parent: this });

        // Manual validation trigger
        const manualValidation = new command.local.Command(`${name}-manual-validation`, {
            create: this.generateValidationScript(args),
        }, { parent: this, dependsOn: [manualSync] });

        // Create outputs
        const syncStatus = pulumi.all([manualSync.stdout, manualValidation.stdout])
            .apply(([syncOutput, validationOutput]) => {
                const status: Record<string, any> = {};

                for (const target of syncTargets) {
                    status[target.name] = {
                        lastSync: new Date().toISOString(),
                        status: syncOutput?.includes(`${target.name}: success`) ? "success" : "failed",
                        errors: syncOutput?.includes("error") ? [syncOutput] : undefined,
                    };
                }

                return status;
            });

        const validationResults = pulumi.all([manualValidation.stdout])
            .apply(([validationOutput]) => {
                const results: Record<string, boolean> = {};

                for (const [credName] of Object.entries(credentialMappings)) {
                    results[credName] = validationOutput?.includes(`${credName}: valid`) || false;
                }

                return results;
            });

        const allCredentialsValid = validationResults.apply(results =>
            Object.values(results).every(valid => valid)
        );

        this.outputs = {
            namespace: namespace?.metadata.name || pulumi.output(namespaceName),
            syncStatus,
            validationResults,
            allCredentialsValid,
        };

        this.registerOutputs(this.outputs);
    }

    private generateSyncScript(args: CredentialSynchronizerArgs): string {
        const { escEnvironment, syncTargets, credentialMappings } = args;

        return `#!/bin/bash
set -e

echo "🔄 Starting Credential Synchronization..."
echo "========================================"

SYNC_LOG="/tmp/credential-sync.log"
echo "Sync started at $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SYNC_LOG"

# Function to sync from ESC to 1Password
sync_esc_to_1password() {
    local cred_name="$1"
    local item_id="$2"
    local vault="$3"

    echo "  → Syncing $cred_name to 1Password..."

    # Get value from ESC
    VALUE=$(esc env get ${escEnvironment} --format json | jq -r ".$cred_name // empty" 2>/dev/null || echo "")

    if [ -z "$VALUE" ]; then
        echo "    ⚠️  Credential $cred_name not found in ESC"
        return 1
    fi

    # Update 1Password
    if op item edit "$item_id" --vault "$vault" "$cred_name[text]=$VALUE" 2>/dev/null; then
        echo "    ✅ $cred_name synced to 1Password"
        echo "$cred_name: success" >> "$SYNC_LOG"
    else
        echo "    ❌ Failed to sync $cred_name to 1Password"
        echo "$cred_name: failed" >> "$SYNC_LOG"
        return 1
    fi
}

# Function to sync from 1Password to ESC
sync_1password_to_esc() {
    local cred_name="$1"
    local item_id="$2"
    local vault="$3"

    echo "  → Syncing $cred_name from 1Password to ESC..."

    # Get value from 1Password
    VALUE=$(op item get "$item_id" --vault "$vault" --fields "label=$cred_name" --reveal 2>/dev/null || echo "")

    if [ -z "$VALUE" ]; then
        echo "    ⚠️  Credential $cred_name not found in 1Password"
        return 1
    fi

    # Update ESC
    if esc env set ${escEnvironment} "$cred_name" "$VALUE" --secret 2>/dev/null; then
        echo "    ✅ $cred_name synced to ESC"
        echo "$cred_name: success" >> "$SYNC_LOG"
    else
        echo "    ❌ Failed to sync $cred_name to ESC"
        echo "$cred_name: failed" >> "$SYNC_LOG"
        return 1
    fi
}

# Process each sync target
${syncTargets.map(target => {
    if (target.type === "1password") {
        return `
echo "📦 Processing 1Password sync for ${target.name}..."
for cred_name in ${Object.keys(credentialMappings).join(' ')}; do
    first_key="${Object.keys(credentialMappings)[0] || ''}"
    if [ -n "$first_key" ]; then
        echo "Checking targets for credential sync..."
        sync_esc_to_1password "$cred_name" "${target.configuration.itemId}" "${target.configuration.vault || 'Infrastructure'}"
    fi
done
`;
    }
    return "";
}).join('\n')}

# Update sync metadata
esc env set ${escEnvironment} "sync.last_sync" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --plaintext
esc env set ${escEnvironment} "sync.sync_targets" "${syncTargets.length}" --plaintext

echo ""
echo "✅ Credential synchronization completed!"
echo "Sync log: $SYNC_LOG"
cat "$SYNC_LOG"
`;
    }

    private generateValidationScript(args: CredentialSynchronizerArgs): string {
        const { escEnvironment, credentialMappings } = args;

        return `#!/bin/bash
set -e

echo "🔍 Starting Credential Validation..."
echo "==================================="

VALIDATION_LOG="/tmp/credential-validation.log"
echo "Validation started at $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$VALIDATION_LOG"

# Function to validate K3s token format
validate_k3s_token() {
    local token="$1"

    if [[ "$token" =~ ^K10[a-f0-9]{32}::server:[a-f0-9]{16}$ ]]; then
        return 0
    else
        return 1
    fi
}

# Function to validate SSH key format
validate_ssh_key() {
    local key="$1"

    if echo "$key" | ssh-keygen -l -f - >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to validate API token format (generic)
validate_api_token() {
    local token="$1"

    if [ \${#token} -ge 20 ] && [[ "$token" =~ ^[A-Za-z0-9_-]+\$ ]]; then
        return 0
    else
        return 1
    fi
}

# Validate each credential
${Object.entries(credentialMappings).map(([credName, config]) => `
echo "🔍 Validating $credName..."

# Get credential value from ESC
CRED_VALUE=$(esc env get ${escEnvironment} --format json | jq -r ".$credName // empty" 2>/dev/null || echo "")

if [ -z "$CRED_VALUE" ]; then
    echo "    ❌ $credName: not found in ESC"
    echo "$credName: invalid" >> "$VALIDATION_LOG"
else
    # Validate based on format
    case "${config.validation?.format || 'api-token'}" in
        "k3s-token")
            if validate_k3s_token "$CRED_VALUE"; then
                echo "    ✅ $credName: valid K3s token format"
                echo "$credName: valid" >> "$VALIDATION_LOG"
            else
                echo "    ❌ $credName: invalid K3s token format"
                echo "$credName: invalid" >> "$VALIDATION_LOG"
            fi
            ;;
        "ssh-key")
            if validate_ssh_key "$CRED_VALUE"; then
                echo "    ✅ $credName: valid SSH key format"
                echo "$credName: valid" >> "$VALIDATION_LOG"
            else
                echo "    ❌ $credName: invalid SSH key format"
                echo "$credName: invalid" >> "$VALIDATION_LOG"
            fi
            ;;
        "api-token")
            if validate_api_token "$CRED_VALUE"; then
                echo "    ✅ $credName: valid API token format"
                echo "$credName: valid" >> "$VALIDATION_LOG"
            else
                echo "    ❌ $credName: invalid API token format"
                echo "$credName: invalid" >> "$VALIDATION_LOG"
            fi
            ;;
        *)
            echo "    ⚠️  $credName: unknown validation format"
            echo "$credName: unknown" >> "$VALIDATION_LOG"
            ;;
    esac
fi
`).join('\n')}

# Count results
TOTAL_CREDS=$(wc -l < "$VALIDATION_LOG" | tail -1)
VALID_CREDS=$(grep -c ": valid" "$VALIDATION_LOG" || echo "0")
INVALID_CREDS=$(grep -c ": invalid" "$VALIDATION_LOG" || echo "0")

echo ""
echo "📊 Validation Summary"
echo "===================="
echo "Total credentials: $TOTAL_CREDS"
echo "Valid: $VALID_CREDS"
echo "Invalid: $INVALID_CREDS"

# Update ESC with validation results
esc env set ${escEnvironment} "validation.last_validation" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --plaintext
esc env set ${escEnvironment} "validation.valid_count" "$VALID_CREDS" --plaintext
esc env set ${escEnvironment} "validation.invalid_count" "$INVALID_CREDS" --plaintext

echo ""
echo "✅ Credential validation completed!"
echo "Validation log: $VALIDATION_LOG"
cat "$VALIDATION_LOG"
`;
    }
}
