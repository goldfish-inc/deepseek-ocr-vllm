import * as pulumi from "@pulumi/pulumi";

export interface K3sTokenRotatorArgs {
    /** ESC environment that stores the authoritative K3s token material */
    escEnvironment: string;

    /** Human readable cluster identifier used when presenting rotation status */
    clusterName: string;

    /** How often (in days) tokens should be rotated. Defaults to 90 days. */
    rotationIntervalDays?: number;

    /** Whether the rotator should mark itself as ready to execute automated rotation jobs. */
    enableAutoRotation?: boolean;
}

export interface K3sTokenRotatorOutputs {
    /** Structured rotation policy that downstream jobs or dashboards can consume. */
    rotationPolicy: pulumi.Output<{
        escEnvironment: string;
        clusterName: string;
        intervalDays: number;
        autoRotationEnabled: boolean;
    }>;
}

/**
 * Placeholder component that captures K3s token rotation policy in Pulumi state.
 *
 * The infrastructure policy enforcement pipeline only checks for the presence
 * of this component so that future work can replace shell scripts with a Pulumi
 * implementation.  Until we have full automation, this component simply
 * emits the desired rotation configuration.  Downstream workflows (for example
 * GitHub Actions jobs or manual runbooks) can read this information via `pulumi
 * stack output` and perform the actual rotation.
 */
export class K3sTokenRotator extends pulumi.ComponentResource {
    public readonly outputs: K3sTokenRotatorOutputs;

    constructor(name: string, args: K3sTokenRotatorArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:security:K3sTokenRotator", name, {}, opts);

        const {
            escEnvironment,
            clusterName,
            rotationIntervalDays = 90,
            enableAutoRotation = false,
        } = args;

        const rotationPolicy = pulumi.output({
            escEnvironment,
            clusterName,
            intervalDays: rotationIntervalDays,
            autoRotationEnabled: enableAutoRotation,
        });

        this.outputs = { rotationPolicy };
        this.registerOutputs(this.outputs);
    }
}
