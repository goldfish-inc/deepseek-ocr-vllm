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

        // Transformation to strip Helm hook annotations so Pulumi keeps the Deployments
        const stripHelmHooks: pulumi.ResourceTransformation = ({ props, opts }) => {
            const annotations = props?.metadata?.annotations;
            if (annotations && annotations["helm.sh/hook"]) {
                const cleaned = { ...props, metadata: { ...props.metadata, annotations: { ...annotations } } };
                delete cleaned.metadata.annotations["helm.sh/hook"];
                delete cleaned.metadata.annotations["helm.sh/hook-weight"];
                delete cleaned.metadata.annotations["helm.sh/hook-delete-policy"];
                return { props: cleaned, opts };
            }
            return undefined;
        };

        // Flux v2.7.0 controller versions (each has independent versioning)
        const fluxCliTag = "v2.7.0";
        const sourceControllerTag = "v1.7.0";
        const kustomizeControllerTag = "v1.7.0";
        const helmControllerTag = "v1.4.0";
        const notificationControllerTag = "v1.7.1";
        const imageAutomationControllerTag = "v1.0.1";
        const imageReflectorControllerTag = "v1.0.1";

        // Deploy Flux via k8s.helm.v4.Chart with SSA
        // skipAwait allows SSA to handle field manager conflicts during migration from v3
        const release = new k8s.helm.v4.Chart(`${name}-flux`, {
            chart: "flux2",
            version: chartVersion,
            repositoryOpts: {
                repo: "https://fluxcd-community.github.io/helm-charts",
            },
            namespace: namespaceName,
            skipAwait: true, // Allow SSA to handle field manager migration
            values: {
                installCRDs: true,
                cli: {
                    image: "ghcr.io/fluxcd/flux-cli",
                    tag: fluxCliTag,
                },
                sourceController: {
                    image: "ghcr.io/fluxcd/source-controller",
                    tag: sourceControllerTag,
                },
                kustomizeController: {
                    image: "ghcr.io/fluxcd/kustomize-controller",
                    tag: kustomizeControllerTag,
                },
                helmController: {
                    image: "ghcr.io/fluxcd/helm-controller",
                    tag: helmControllerTag,
                },
                notificationController: {
                    image: "ghcr.io/fluxcd/notification-controller",
                    tag: notificationControllerTag,
                },
                imageAutomationController: {
                    image: "ghcr.io/fluxcd/image-automation-controller",
                    tag: imageAutomationControllerTag,
                },
                imageReflectorController: {
                    image: "ghcr.io/fluxcd/image-reflector-controller",
                    tag: imageReflectorControllerTag,
                },
            },
        }, {
            provider: k8sProvider,
            parent: this,
            dependsOn: namespace ? [namespace] : undefined,
            transformations: [stripHelmHooks],
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
