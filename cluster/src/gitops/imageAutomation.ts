import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ClusterConfig } from "../config";

export interface ImageAutomationArgs {
    cluster: ClusterConfig;
    k8sProvider: k8s.Provider;
    fluxNamespace: string;
}

export class ImageAutomation extends pulumi.ComponentResource {
    constructor(name: string, args: ImageAutomationArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:monitoring:ImageAutomation", name, {}, opts);

        const { cluster, k8sProvider, fluxNamespace } = args;

        const cloudflaredImageRepo = new k8s.apiextensions.CustomResource(`${name}-cloudflared-repo`, {
            apiVersion: "image.toolkit.fluxcd.io/v1beta2",
            kind: "ImageRepository",
            metadata: {
                name: "cloudflared",
                namespace: fluxNamespace,
            },
            spec: {
                image: "cloudflare/cloudflared",
                interval: "1h",
                provider: "generic",
            },
        }, { provider: k8sProvider, parent: this });

        const cloudflaredImagePolicy = new k8s.apiextensions.CustomResource(`${name}-cloudflared-policy`, {
            apiVersion: "image.toolkit.fluxcd.io/v1beta2",
            kind: "ImagePolicy",
            metadata: {
                name: "cloudflared",
                namespace: fluxNamespace,
            },
            spec: {
                imageRepositoryRef: {
                    name: "cloudflared",
                },
                policy: {
                    semver: {
                        range: ">=1.0.0",
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [cloudflaredImageRepo] });

        const certManagerImageRepo = new k8s.apiextensions.CustomResource(`${name}-cert-manager-repo`, {
            apiVersion: "image.toolkit.fluxcd.io/v1beta2",
            kind: "ImageRepository",
            metadata: {
                name: "cert-manager",
                namespace: fluxNamespace,
            },
            spec: {
                image: "quay.io/jetstack/cert-manager-controller",
                interval: "1h",
            },
        }, { provider: k8sProvider, parent: this });

        const certManagerImagePolicy = new k8s.apiextensions.CustomResource(`${name}-cert-manager-policy`, {
            apiVersion: "image.toolkit.fluxcd.io/v1beta2",
            kind: "ImagePolicy",
            metadata: {
                name: "cert-manager",
                namespace: fluxNamespace,
            },
            spec: {
                imageRepositoryRef: {
                    name: "cert-manager",
                },
                policy: {
                    semver: {
                        range: ">=1.0.0 <2.0.0",
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [certManagerImageRepo] });

        new k8s.apiextensions.CustomResource(`${name}-update-automation`, {
            apiVersion: "image.toolkit.fluxcd.io/v1beta2",
            kind: "ImageUpdateAutomation",
            metadata: {
                name: "flux-system",
                namespace: fluxNamespace,
            },
            spec: {
                interval: "1h",
                sourceRef: {
                    kind: "GitRepository",
                    name: "flux-system",
                },
                git: {
                    checkout: {
                        ref: {
                            branch: cluster.gitops.branch,
                        },
                    },
                    commit: {
                        author: {
                            email: "flux@boathou.se",
                            name: "Flux Bot",
                        },
                        messageTemplate: `chore: automated image updates

{{range .Changed}}
- {{.Registry}}/{{.Repository}}:{{.OldTag}} → {{.NewTag}}
{{end}}

[ci skip]`,
                    },
                    push: {
                        branch: "flux-image-updates",
                        refspec: "refs/heads/flux-image-updates:refs/heads/flux-image-updates",
                    },
                },
                update: {
                    path: "./clusters/tethys",
                    strategy: "Setters",
                },
            },
        }, { provider: k8sProvider, parent: this });

        new k8s.apiextensions.CustomResource(`${name}-version-alert`, {
            apiVersion: "notification.toolkit.fluxcd.io/v1beta3",
            kind: "Alert",
            metadata: {
                name: "image-updates",
                namespace: fluxNamespace,
            },
            spec: {
                providerRef: {
                    name: "github-updates",
                },
                eventSeverity: "info",
                eventSources: [{
                    kind: "ImageRepository",
                    name: "*",
                }, {
                    kind: "ImagePolicy",
                    name: "*",
                }],
                summary: "New container image versions detected",
            },
        }, { provider: k8sProvider, parent: this });

        new k8s.apiextensions.CustomResource(`${name}-github-provider`, {
            apiVersion: "notification.toolkit.fluxcd.io/v1beta3",
            kind: "Provider",
            metadata: {
                name: "github-updates",
                namespace: fluxNamespace,
            },
            spec: {
                type: "github",
                address: "https://github.com/goldfish-inc/oceanid",
                secretRef: {
                    name: "github-token",
                },
            },
        }, { provider: k8sProvider, parent: this });

        this.registerOutputs({
            imageRepositories: ["cloudflared", "cert-manager"],
            updateAutomation: "flux-system",
        });
    }
}
