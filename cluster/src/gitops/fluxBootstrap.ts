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

        const githubToken = cfg.getSecret("github.token");
        const githubTokenSecret = githubToken
            ? new k8s.core.v1.Secret(`${name}-github-token`, {
                metadata: {
                    name: "github-token",
                    namespace: namespaceName,
                },
                type: "Opaque",
                stringData: {
                    username: "git",
                    password: githubToken,
                },
            }, { provider: k8sProvider, parent: this, dependsOn: namespace ? [namespace] : undefined })
            : undefined;

        // Deploy Flux via k8s.helm.v3.Chart (not Release)
        // This avoids the Pulumi Helm provider bug where Release.upgrade() deletes
        // resources without recreating them (https://github.com/pulumi/pulumi-kubernetes/issues/2625)
        // Chart renders the manifest and applies it as native Kubernetes resources
        const release = new k8s.helm.v3.Chart(`${name}-flux`, {
            chart: "flux2",
            version: chartVersion,
            fetchOpts: {
                repo: "https://fluxcd-community.github.io/helm-charts",
            },
            namespace: namespaceName,
            values: {
                installCRDs: true,
                cli: {
                    image: "ghcr.io/fluxcd/flux-cli",
                    tag: "v2.6.4",
                },
                // Ensure all controllers are enabled
                sourceController: { create: true },
                kustomizeController: { create: true },
                helmController: { create: true },
                notificationController: { create: true },
                imageAutomationController: { create: true },
                imageReflectorController: { create: true },
            },
        }, {
            provider: k8sProvider,
            parent: this,
            dependsOn: namespace ? [namespace] : undefined,
        });

        const gitRepoUrl = sshSecret && cluster.gitops.repositoryUrl.startsWith("https://")
            ? cluster.gitops.repositoryUrl.replace("https://", "ssh://git@")
            : cluster.gitops.repositoryUrl;

        const gitRepository = new k8s.apiextensions.CustomResource(`${name}-git-repo`, {
            apiVersion: "source.toolkit.fluxcd.io/v1",
            kind: "GitRepository",
            metadata: {
                name: "flux-system",
                namespace: namespaceName,
            },
            spec: {
                interval: `${cluster.gitops.intervalSeconds}s`,
                url: gitRepoUrl,
                ref: {
                    branch: cluster.gitops.branch,
                },
                secretRef: sshSecret ? {
                    name: "flux-system-ssh",
                } : githubTokenSecret ? {
                    name: "github-token",
                } : undefined,
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [release, ...(sshSecret ? [sshSecret] : []), ...(githubTokenSecret ? [githubTokenSecret] : [])] });

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
