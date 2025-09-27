import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { ClusterConfig } from "../config";

export interface FluxBootstrapArgs {
    cluster: ClusterConfig;
    k8sProvider: k8s.Provider;
    createNamespace?: boolean;
    chartVersion?: string;
}

export class FluxBootstrap extends pulumi.ComponentResource {
    public readonly namespace: pulumi.Output<string>;

    constructor(name: string, args: FluxBootstrapArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:gitops:FluxBootstrap", name, {}, opts);

        const { cluster, k8sProvider, createNamespace = true, chartVersion = "2.16.4" } = args;
        const namespaceName = "flux-system";

        const namespace = createNamespace
            ? new k8s.core.v1.Namespace(`${name}-ns`, {
                metadata: {
                    name: namespaceName,
                    labels: {
                        "app.kubernetes.io/part-of": "flux",
                        "pod-security.kubernetes.io/enforce": "baseline",
                    },
                },
            }, { provider: k8sProvider, parent: this })
            : undefined;

        // Create SSH secret for private repository access
        const cfg = new pulumi.Config();
        const sshPrivateKey = cfg.getSecret("flux.ssh_private_key");
        const knownHosts = cfg.get("flux.known_hosts");

        const sshSecret = sshPrivateKey && knownHosts
            ? new k8s.core.v1.Secret(`${name}-ssh`, {
                metadata: {
                    name: "flux-system-ssh",
                    namespace: namespaceName,
                },
                type: "Opaque",
                stringData: {
                    identity: sshPrivateKey,
                    known_hosts: knownHosts,
                },
            }, { provider: k8sProvider, parent: this, dependsOn: namespace ? [namespace] : undefined })
            : undefined;

        // Create GitHub token secret for automated PRs (from ESC)
        const githubToken = cfg.getSecret("github.token");
        const githubTokenSecret = githubToken
            ? new k8s.core.v1.Secret(`${name}-github-token`, {
                metadata: {
                    name: "github-token",
                    namespace: namespaceName,
                },
                type: "Opaque",
                stringData: {
                    token: githubToken,
                },
            }, { provider: k8sProvider, parent: this, dependsOn: namespace ? [namespace] : undefined })
            : undefined;

        const release = new k8s.helm.v3.Release(`${name}-flux`, {
            chart: "flux2",
            version: chartVersion,
            repositoryOpts: {
                repo: "https://fluxcd-community.github.io/helm-charts",
            },
            namespace: namespaceName,
            createNamespace,
            skipCrds: false,
            values: {
                installCRDs: true,
                components: [
                    "source-controller",
                    "kustomize-controller",
                    "helm-controller",
                    "notification-controller",
                    "image-automation-controller",
                    "image-reflector-controller",
                ],
            },
        }, { provider: k8sProvider, parent: this, dependsOn: namespace ? [namespace] : undefined });

        const gitRepository = new k8s.apiextensions.CustomResource(`${name}-git-repo`, {
            apiVersion: "source.toolkit.fluxcd.io/v1",
            kind: "GitRepository",
            metadata: {
                name: "flux-system",
                namespace: namespaceName,
            },
            spec: {
                interval: `${cluster.gitops.intervalSeconds}s`,
                url: cluster.gitops.repositoryUrl.replace("https://", "ssh://git@"),
                ref: {
                    branch: cluster.gitops.branch,
                },
                secretRef: sshSecret ? {
                    name: "flux-system-ssh",
                } : undefined,
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [release, ...(sshSecret ? [sshSecret] : [])] });

        new k8s.apiextensions.CustomResource(`${name}-kustomization`, {
            apiVersion: "kustomize.toolkit.fluxcd.io/v1",
            kind: "Kustomization",
            metadata: {
                name: "flux-system",
                namespace: namespaceName,
            },
            spec: {
                interval: `${cluster.gitops.reconciliationSeconds}s`,
                path: cluster.gitops.path,
                prune: true,
                wait: true,
                force: false,
                sourceRef: {
                    kind: "GitRepository",
                    name: gitRepository.metadata.name,
                },
                healthChecks: [
                    {
                        apiVersion: "kustomize.toolkit.fluxcd.io/v1",
                        kind: "Kustomization",
                        name: "flux-system",
                        namespace: namespaceName,
                    },
                ],
            },
        }, { provider: k8sProvider, parent: this, dependsOn: gitRepository });

        this.namespace = pulumi.output(namespaceName);
        this.registerOutputs({ namespace: this.namespace });
    }
}
