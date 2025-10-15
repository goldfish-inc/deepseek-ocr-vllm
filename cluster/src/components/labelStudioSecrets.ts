import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface LabelStudioSecretsArgs {
    k8sProvider: k8s.Provider;
    namespace: string;
    labelStudioDbUrl: pulumi.Input<string>;
    awsAccessKeyId: pulumi.Input<string>;
    awsSecretAccessKey: pulumi.Input<string>;
    awsBucketName: string;
    awsRegion: string;
}

/**
 * LabelStudioSecrets
 *
 * Syncs secrets from Pulumi ESC to Kubernetes for Flux-managed Label Studio.
 * This component creates the required secrets that the Label Studio HelmRelease expects.
 */
export class LabelStudioSecrets extends pulumi.ComponentResource {
    public readonly dbSecretName: pulumi.Output<string>;
    public readonly s3SecretName: pulumi.Output<string>;

    constructor(name: string, args: LabelStudioSecretsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:apps:LabelStudioSecrets", name, {}, opts);

        const { k8sProvider, namespace, labelStudioDbUrl, awsAccessKeyId, awsSecretAccessKey, awsBucketName, awsRegion } = args;

        // Create Kubernetes secret for database credentials
        // Label Studio requires POSTGRE_PASSWORD (not just DATABASE_URL)
        const dbSecret = new k8s.core.v1.Secret(`${name}-db`, {
            metadata: {
                name: "label-studio-db-credentials",
                namespace,
                labels: {
                    "oceanid.cluster/managed-by": "pulumi",
                    "oceanid.cluster/sync-source": "esc",
                },
                annotations: {
                    // Prevent Flux from pruning Pulumi-managed secrets
                    "kustomize.toolkit.fluxcd.io/prune": "disabled",
                },
            },
            stringData: {
                DATABASE_URL: labelStudioDbUrl as any,
                // Extract password from URL for POSTGRE_PASSWORD env var
                POSTGRE_PASSWORD: pulumi.output(labelStudioDbUrl).apply(url => {
                    const urlStr = url || "";
                    const match = urlStr.match(/:\/\/[^:]+:([^@]+)@/);
                    return match && match[1] ? decodeURIComponent(match[1]) : "";
                }),
            },
        }, { provider: k8sProvider, parent: this });

        // Create Kubernetes secret for S3 credentials
        const s3Secret = new k8s.core.v1.Secret(`${name}-s3`, {
            metadata: {
                name: "labelstudio-s3-credentials",
                namespace,
                labels: {
                    "oceanid.cluster/managed-by": "pulumi",
                    "oceanid.cluster/sync-source": "esc",
                },
                annotations: {
                    // Prevent Flux from pruning Pulumi-managed secrets
                    "kustomize.toolkit.fluxcd.io/prune": "disabled",
                },
            },
            stringData: {
                AWS_ACCESS_KEY_ID: awsAccessKeyId as any,
                AWS_SECRET_ACCESS_KEY: awsSecretAccessKey as any,
                AWS_STORAGE_BUCKET_NAME: awsBucketName,
                AWS_S3_REGION_NAME: awsRegion,
            },
        }, { provider: k8sProvider, parent: this });

        this.dbSecretName = dbSecret.metadata.name;
        this.s3SecretName = s3Secret.metadata.name;

        this.registerOutputs({
            dbSecretName: this.dbSecretName,
            s3SecretName: this.s3SecretName,
        });
    }
}
