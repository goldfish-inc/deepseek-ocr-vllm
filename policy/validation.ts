// Lightweight Policy Validation for Pulumi Free Tier
// Run locally during preview - no CrossGuard quota usage

import * as pulumi from "@pulumi/pulumi";

// =============================================================================
// POLICY VALIDATION FRAMEWORK (Free Tier Friendly)
// =============================================================================

export interface ValidationRule {
    name: string;
    description: string;
    severity: "error" | "warning" | "info";
    validate: (resource: any) => ValidationResult;
}

export interface ValidationResult {
    valid: boolean;
    message?: string;
}

// =============================================================================
// KUBERNETES POLICIES
// =============================================================================

export const k8sPolicies: ValidationRule[] = [
    {
        name: "require-resource-limits",
        description: "All containers must have resource limits",
        severity: "error",
        validate: (resource: any) => {
            if (resource.type !== "kubernetes:core/v1:Pod" &&
                resource.type !== "kubernetes:apps/v1:Deployment") {
                return { valid: true };
            }

            const spec = resource.props?.spec;
            if (!spec) return { valid: true };

            const containers = spec.template?.spec?.containers || spec.containers || [];

            for (const container of containers) {
                if (!container.resources?.limits?.memory || !container.resources?.limits?.cpu) {
                    return {
                        valid: false,
                        message: `Container ${container.name} missing resource limits`
                    };
                }
            }

            return { valid: true };
        }
    },
    {
        name: "require-namespace-labels",
        description: "Namespaces must have required labels",
        severity: "error",
        validate: (resource: any) => {
            if (resource.type !== "kubernetes:core/v1:Namespace") {
                return { valid: true };
            }

            const labels = resource.props?.metadata?.labels || {};
            const required = ["oceanid.cluster/managed-by", "oceanid.cluster/component"];

            for (const label of required) {
                if (!labels[label]) {
                    return {
                        valid: false,
                        message: `Namespace missing required label: ${label}`
                    };
                }
            }

            return { valid: true };
        }
    },
    {
        name: "network-policy-required",
        description: "Each namespace should have NetworkPolicy",
        severity: "warning",
        validate: (resource: any) => {
            if (resource.type !== "kubernetes:core/v1:Namespace") {
                return { valid: true };
            }

            // This is a warning - would need to check if NetworkPolicy exists
            return {
                valid: true,
                message: "Remember to create NetworkPolicy for this namespace"
            };
        }
    },
    {
        name: "prohibit-nodeport",
        description: "NodePort services are not allowed",
        severity: "error",
        validate: (resource: any) => {
            if (resource.type !== "kubernetes:core/v1:Service") {
                return { valid: true };
            }

            if (resource.props?.spec?.type === "NodePort") {
                return {
                    valid: false,
                    message: "NodePort services are prohibited. Use ClusterIP with Cloudflare Tunnel"
                };
            }

            return { valid: true };
        }
    }
];

// =============================================================================
// SECURITY POLICIES
// =============================================================================

export const securityPolicies: ValidationRule[] = [
    {
        name: "no-root-containers",
        description: "Containers must not run as root",
        severity: "error",
        validate: (resource: any) => {
            if (!resource.type?.includes("Deployment") && !resource.type?.includes("Pod")) {
                return { valid: true };
            }

            const containers = resource.props?.spec?.template?.spec?.containers ||
                              resource.props?.spec?.containers || [];

            for (const container of containers) {
                const securityContext = container.securityContext;
                if (!securityContext?.runAsNonRoot) {
                    return {
                        valid: false,
                        message: `Container ${container.name} may run as root`
                    };
                }
            }

            return { valid: true };
        }
    },
    {
        name: "require-pod-security-context",
        description: "Pods must have security context",
        severity: "warning",
        validate: (resource: any) => {
            if (!resource.type?.includes("Deployment") && !resource.type?.includes("Pod")) {
                return { valid: true };
            }

            const securityContext = resource.props?.spec?.template?.spec?.securityContext ||
                                   resource.props?.spec?.securityContext;

            if (!securityContext) {
                return {
                    valid: false,
                    message: "Pod should have securityContext defined"
                };
            }

            return { valid: true };
        }
    },
    {
        name: "secrets-encryption",
        description: "Secrets must be marked for encryption",
        severity: "error",
        validate: (resource: any) => {
            if (resource.type !== "kubernetes:core/v1:Secret") {
                return { valid: true };
            }

            const annotations = resource.props?.metadata?.annotations || {};
            if (!annotations["oceanid.cluster/encrypted"]) {
                return {
                    valid: false,
                    message: "Secret must have oceanid.cluster/encrypted annotation"
                };
            }

            return { valid: true };
        }
    }
];

// =============================================================================
// COST POLICIES
// =============================================================================

export const costPolicies: ValidationRule[] = [
    {
        name: "resource-limits-reasonable",
        description: "Resource requests should be reasonable",
        severity: "warning",
        validate: (resource: any) => {
            if (!resource.type?.includes("Deployment") && !resource.type?.includes("Pod")) {
                return { valid: true };
            }

            const containers = resource.props?.spec?.template?.spec?.containers ||
                              resource.props?.spec?.containers || [];

            for (const container of containers) {
                const limits = container.resources?.limits;
                if (limits?.memory) {
                    const memory = parseInt(limits.memory);
                    if (memory > 2048) { // 2Gi
                        return {
                            valid: false,
                            message: `Container ${container.name} requests excessive memory: ${limits.memory}`
                        };
                    }
                }
                if (limits?.cpu) {
                    const cpu = parseFloat(limits.cpu);
                    if (cpu > 2) {
                        return {
                            valid: false,
                            message: `Container ${container.name} requests excessive CPU: ${limits.cpu}`
                        };
                    }
                }
            }

            return { valid: true };
        }
    }
];

// =============================================================================
// TAGGING POLICIES
// =============================================================================

export const taggingPolicies: ValidationRule[] = [
    {
        name: "require-standard-labels",
        description: "Resources must have standard labels",
        severity: "error",
        validate: (resource: any) => {
            const labels = resource.props?.metadata?.labels || {};
            const required = ["app.kubernetes.io/name", "app.kubernetes.io/managed-by"];

            for (const label of required) {
                if (!labels[label]) {
                    return {
                        valid: false,
                        message: `Resource missing required label: ${label}`
                    };
                }
            }

            return { valid: true };
        }
    },
    {
        name: "require-environment-label",
        description: "Resources must specify environment",
        severity: "warning",
        validate: (resource: any) => {
            const labels = resource.props?.metadata?.labels || {};

            if (!labels["oceanid.cluster/environment"]) {
                return {
                    valid: false,
                    message: "Resource should have oceanid.cluster/environment label"
                };
            }

            return { valid: true };
        }
    }
];

// =============================================================================
// VALIDATION RUNNER
// =============================================================================

export class PolicyValidator {
    private policies: ValidationRule[] = [];
    private violations: Array<{rule: string; resource: string; message: string}> = [];

    constructor() {
        this.policies = [
            ...k8sPolicies,
            ...securityPolicies,
            ...costPolicies,
            ...taggingPolicies
        ];
    }

    validateResource(resource: any): void {
        for (const policy of this.policies) {
            const result = policy.validate(resource);

            if (!result.valid) {
                this.violations.push({
                    rule: policy.name,
                    resource: resource.name || "unknown",
                    message: result.message || policy.description
                });

                if (policy.severity === "error") {
                    console.error(`❌ Policy violation [${policy.name}]: ${result.message}`);
                } else if (policy.severity === "warning") {
                    console.warn(`⚠️  Policy warning [${policy.name}]: ${result.message}`);
                }
            }
        }
    }

    hasErrors(): boolean {
        return this.violations.some(v => {
            const policy = this.policies.find(p => p.name === v.rule);
            return policy?.severity === "error";
        });
    }

    getReport(): string {
        if (this.violations.length === 0) {
            return "✅ All policies passed";
        }

        let report = "Policy Validation Report\n";
        report += "========================\n\n";

        const errors = this.violations.filter(v => {
            const policy = this.policies.find(p => p.name === v.rule);
            return policy?.severity === "error";
        });

        const warnings = this.violations.filter(v => {
            const policy = this.policies.find(p => p.name === v.rule);
            return policy?.severity === "warning";
        });

        if (errors.length > 0) {
            report += `❌ Errors (${errors.length}):\n`;
            errors.forEach(e => {
                report += `  - [${e.rule}] ${e.resource}: ${e.message}\n`;
            });
        }

        if (warnings.length > 0) {
            report += `\n⚠️  Warnings (${warnings.length}):\n`;
            warnings.forEach(w => {
                report += `  - [${w.rule}] ${w.resource}: ${w.message}\n`;
            });
        }

        return report;
    }
}

// =============================================================================
// PULUMI INTEGRATION
// =============================================================================

export function validateStack(): void {
    const validator = new PolicyValidator();

    // Hook into Pulumi runtime
    pulumi.runtime.registerStackTransformation((args) => {
        validator.validateResource(args);
        return args;
    });

    // Fail if errors
    if (validator.hasErrors()) {
        throw new Error("Policy validation failed. See errors above.");
    }
}

// =============================================================================
// STANDALONE VALIDATION SCRIPT
// =============================================================================

if (require.main === module) {
    console.log("Running policy validation...");
    validateStack();
}
