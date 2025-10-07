import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { SSHKeyManager } from "./sshKeyManager";
import { K3sTokenRotator } from "./k3sTokenRotator";
import { SecurityHardening } from "./securityHardening";
import { CredentialSynchronizer } from "./credentialSynchronizer";
export interface MigrationOrchestratorArgs {
    k8sProvider: k8s.Provider;
    escEnvironment: string;
    migrationPhase: "preparation" | "parallel-validation" | "cutover" | "cleanup";
    enableSSHRotation?: boolean;
    enableK3sRotation?: boolean;
    enableSecurityHardening?: boolean;
    enableCredentialSync?: boolean;
    nodes: Record<string, {
        ip: string;
        hostname: string;
        user: string;
        privateKey: pulumi.Input<string>;
        onePasswordItemId?: string;
    }>;
}

export interface MigrationOrchestratorOutputs {
    migrationStatus: pulumi.Output<{
        phase: string;
        completedComponents: string[];
        activeComponents: string[];
        nextSteps: string[];
    }>;
    componentHealth: pulumi.Output<Record<string, boolean>>;
    scriptRetirementReady: pulumi.Output<boolean>;
}

export class MigrationOrchestrator extends pulumi.ComponentResource {
    public readonly outputs: MigrationOrchestratorOutputs;

    constructor(name: string, args: MigrationOrchestratorArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:migration:MigrationOrchestrator", name, {}, opts);

        const {
            k8sProvider,
            escEnvironment,
            migrationPhase,
            enableSSHRotation = true,
            enableK3sRotation = true,
            enableSecurityHardening = true,
            enableCredentialSync = true,
            nodes
        } = args;

        const completedComponents: string[] = [];
        const activeComponents: string[] = [];
        const componentHealth: Record<string, pulumi.Output<boolean>> = {};

        // =================================================================
        // PHASE 1: PREPARATION - Deploy IaC components alongside scripts
        // =================================================================

        let sshKeyManager: SSHKeyManager | undefined;
        let k3sTokenRotator: K3sTokenRotator | undefined;
        let securityHardening: SecurityHardening | undefined;
        let credentialSynchronizer: CredentialSynchronizer | undefined;

        if (migrationPhase === "preparation" || migrationPhase === "parallel-validation") {
            if (enableSSHRotation) {
                activeComponents.push("SSH Key Manager");

                const sshNodes = Object.fromEntries(
                    Object.entries(nodes).map(([nodeId, nodeConfig]) => [
                        nodeId,
                        {
                            nodeId,
                            hostname: nodeConfig.hostname,
                            ip: nodeConfig.ip,
                            user: nodeConfig.user,
                            onePasswordItemId: nodeConfig.onePasswordItemId,
                        }
                    ])
                );

                sshKeyManager = new SSHKeyManager(`${name}-ssh`, {
                    nodes: sshNodes,
                    escEnvironment,
                    rotationIntervalDays: 90,
                    enableAutoRotation: migrationPhase === "parallel-validation",
                }, { parent: this });

                componentHealth["ssh-key-manager"] = sshKeyManager.outputs.allKeysReady;
            }

            if (enableK3sRotation) {
                activeComponents.push("K3s Token Rotator");

                const masterNode = Object.entries(nodes).find(([_, config]) =>
                    config.hostname.includes("tethys") || config.hostname.includes("srv712429")
                );
                const workerNodes = Object.entries(nodes).filter(([_, config]) =>
                    !config.hostname.includes("tethys") && !config.hostname.includes("srv712429")
                );

                if (masterNode) {
                    k3sTokenRotator = new K3sTokenRotator(`${name}-k3s`, {
                        masterNode: {
                            ip: masterNode[1].ip,
                            hostname: masterNode[1].hostname,
                            user: masterNode[1].user,
                            privateKey: masterNode[1].privateKey,
                        },
                        workerNodes: workerNodes.map(([_, config]) => ({
                            ip: config.ip,
                            hostname: config.hostname,
                            user: config.user,
                            privateKey: config.privateKey,
                        })),
                        escEnvironment,
                        rotationIntervalDays: 90,
                        enableAutoRotation: migrationPhase === "parallel-validation",
                    }, { parent: this });

                    componentHealth["k3s-token-rotator"] = k3sTokenRotator.outputs.allNodesReady;
                }
            }

            if (enableSecurityHardening) {
                activeComponents.push("Security Hardening");

                securityHardening = new SecurityHardening(`${name}-security`, {
                    k8sProvider,
                    enableSSHHardening: true,
                    enablePasswordDisable: true,
                    enableFirewallConfig: true,
                    enableAuditLogging: true,
                    enableComplianceReporting: true,
                }, { parent: this });

                componentHealth["security-hardening"] = securityHardening.outputs.hardeningStatus
                    .apply(status => status.sshHardened && status.passwordAuthDisabled);
            }

            if (enableCredentialSync) {
                activeComponents.push("Credential Synchronizer");

                credentialSynchronizer = new CredentialSynchronizer(`${name}-creds`, {
                    k8sProvider,
                    escEnvironment,
                    syncTargets: [
                        {
                            name: "1password-infrastructure",
                            type: "1password",
                            configuration: {
                                vault: "Infrastructure",
                            },
                        },
                    ],
                    credentialMappings: {
                        "k3s.token": {
                            source: "esc",
                            targets: ["1password-infrastructure"],
                            validation: { format: "k3s-token", required: true },
                        },
                        "ssh.tethys_private_key_base64": {
                            source: "esc",
                            targets: ["1password-infrastructure"],
                            validation: { format: "ssh-key", required: true },
                        },
                        "github.token": {
                            source: "esc",
                            targets: ["1password-infrastructure"],
                            validation: { format: "api-token", required: true },
                        },
                    },
                    syncIntervalMinutes: 60,
                    enableValidation: true,
                }, { parent: this });

                componentHealth["credential-synchronizer"] = credentialSynchronizer.outputs.allCredentialsValid;
            }

        }

        // =================================================================
        // PHASE 2: PARALLEL VALIDATION - Run both old and new systems
        // =================================================================

        if (migrationPhase === "parallel-validation") {
            completedComponents.push("IaC Components Deployed");
            // In this phase, both scripts and IaC components are running
            // Monitoring compares outputs to ensure parity
        }

        // =================================================================
        // PHASE 3: CUTOVER - Disable scripts, rely on IaC
        // =================================================================

        if (migrationPhase === "cutover") {
            completedComponents.push("IaC Components Deployed", "Parallel Validation Complete");
            activeComponents.push("IaC-Only Operations");
            // Scripts are marked as deprecated but not yet removed
        }

        // =================================================================
        // PHASE 4: CLEANUP - Remove scripts completely
        // =================================================================

        if (migrationPhase === "cleanup") {
            completedComponents.push(
                "IaC Components Deployed",
                "Parallel Validation Complete",
                "Cutover to IaC Complete"
            );
            activeComponents.push("Script Removal", "Policy Enforcement");
        }

        // Determine next steps based on current phase
        const nextSteps = this.getNextSteps(migrationPhase);

        // Determine if ready to retire scripts
        const scriptRetirementReady = pulumi.all(Object.values(componentHealth))
            .apply(healthChecks => {
                const allHealthy = healthChecks.every(healthy => healthy);
                return allHealthy && (migrationPhase === "cutover" || migrationPhase === "cleanup");
            });

        // Create migration status
        const migrationStatus = pulumi.output({
            phase: migrationPhase,
            completedComponents,
            activeComponents,
            nextSteps,
        });

        this.outputs = {
            migrationStatus,
            componentHealth: pulumi.output(componentHealth),
            scriptRetirementReady,
        };

        this.registerOutputs(this.outputs);
    }

    private getNextSteps(phase: string): string[] {
        switch (phase) {
            case "preparation":
                return [
                    "Deploy all IaC components",
                    "Verify component health",
                    "Move to parallel-validation phase",
                ];
            case "parallel-validation":
                return [
                    "Run both scripts and IaC components",
                    "Compare outputs for parity",
                    "Monitor for 1-2 weeks",
                    "Fix any discrepancies",
                    "Move to cutover phase",
                ];
            case "cutover":
                return [
                    "Stop using scripts for new operations",
                    "Update documentation to reference IaC",
                    "Monitor IaC-only operations",
                    "Mark scripts as deprecated",
                    "Move to cleanup phase",
                ];
            case "cleanup":
                return [
                    "Remove all shell scripts",
                    "Clean up package.json references",
                    "Update CI/CD pipelines",
                    "Implement policy enforcement",
                    "Update audit documentation",
                ];
            default:
                return ["Unknown migration phase"];
        }
    }
}

// =============================================================================
// MIGRATION INTEGRATION EXAMPLE
// =============================================================================

export function createMigrationIntegration(
    k8sProvider: k8s.Provider,
    escEnvironment: string,
    nodes: Record<string, any>
): MigrationOrchestrator {
    return new MigrationOrchestrator("script-retirement", {
        k8sProvider,
        escEnvironment,
        migrationPhase: "preparation", // Start with preparation phase
        enableSSHRotation: true,
        enableK3sRotation: true,
        enableSecurityHardening: true,
        enableCredentialSync: true,
        nodes,
    });
}
