import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

/**
 * SME Readiness Configuration for Label Studio
 * Configures Cloudflare Access and DNS for boathou.se domain
 */
export interface SMEReadinessArgs {
    cloudflareProvider: cloudflare.Provider;
    zoneId: pulumi.Input<string>;
    tunnelId: pulumi.Input<string>;
    nodeTunnelId: pulumi.Input<string>;  // For GPU services
    emailDomain?: pulumi.Input<string>;
    enableLabelStudioAccess?: boolean;
}

export class SMEReadiness extends pulumi.ComponentResource {
    public readonly labelStudioUrl: pulumi.Output<string>;
    public readonly gpuServiceUrl: pulumi.Output<string>;
    public readonly accessPolicyId: pulumi.Output<string>;
    public readonly mlServiceTokenId?: pulumi.Output<string>;
    public readonly mlServiceTokenSecret?: pulumi.Output<string>;

    constructor(name: string, args: SMEReadinessArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:sme:SMEReadiness", name, {}, opts);

        const {
            cloudflareProvider,
            zoneId,
            tunnelId,
            nodeTunnelId,
            emailDomain = "boathou.se",
            enableLabelStudioAccess = true
        } = args;

        // DNS records are already managed elsewhere (tunnel components). Avoid duplicates here.

        // Cloudflare Access Application for Label Studio
        let labelStudioApp: cloudflare.ZeroTrustAccessApplication | undefined;

        if (enableLabelStudioAccess) {
            // Service Token for ML Backend (adapter) - create first so we can reference it
            const serviceToken = new cloudflare.ZeroTrustAccessServiceToken(`${name}-ml-token`, {
                name: "ML Backend Service Token",
                zoneId: zoneId as unknown as string,
            }, { provider: cloudflareProvider, parent: this });

            // Optional: Add individual email exceptions
            const cfg = new pulumi.Config();
            const additionalEmails = cfg.getObject<string[]>("smeAdditionalEmails");

            // Build policies array
            const policies: pulumi.Input<any>[] = [
                // Policy 1: Email domain restriction for SMEs
                {
                    name: "SME Email Domain Access",
                    precedence: 1,
                    decision: "allow",
                    includes: [
                        { emailDomain: { domain: emailDomain } },
                    ],
                },
                // Policy 2: Service token for ML backend
                {
                    name: "ML Backend Service Access",
                    precedence: 10,
                    decision: "allow",
                    includes: [
                        { serviceToken: { tokenId: serviceToken.id } },
                    ],
                },
            ];

            // Add individual emails policy if configured
            if (additionalEmails && additionalEmails.length > 0) {
                policies.splice(1, 0, {
                    name: "SME Individual Access",
                    precedence: 2,
                    decision: "allow",
                    includes: additionalEmails.map(e => ({ email: { email: e } })),
                });
            }

            labelStudioApp = new cloudflare.ZeroTrustAccessApplication(`${name}-label-app`, {
                zoneId: zoneId as unknown as string,
                domain: "label.boathou.se",
                name: "Label Studio - Maritime NER",
                type: "self_hosted",
                sessionDuration: "8h",
                autoRedirectToIdentity: true,
                customDenyMessage: "Access restricted to authorized SME annotators.",
                customDenyUrl: "https://boathou.se/access-denied",
                logoUrl: "https://labelstud.io/images/logo.png",
                policies: policies,
            }, { provider: cloudflareProvider, parent: this, deleteBeforeReplace: true });

            // Store service token outputs
            this.mlServiceTokenId = serviceToken.id;
            this.mlServiceTokenSecret = serviceToken.clientSecret;
        }

        this.labelStudioUrl = pulumi.interpolate`https://label.boathou.se`;
        this.gpuServiceUrl = pulumi.interpolate`https://gpu.boathou.se`;
        this.accessPolicyId = labelStudioApp?.id ?? pulumi.output("");

        this.registerOutputs({
            labelStudioUrl: this.labelStudioUrl,
            gpuServiceUrl: this.gpuServiceUrl,
            accessPolicyId: this.accessPolicyId,
            mlServiceTokenId: this.mlServiceTokenId,
            mlServiceTokenSecret: this.mlServiceTokenSecret,
        });
    }
}
