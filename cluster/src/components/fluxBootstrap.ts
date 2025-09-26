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

        const { cluster, k8sProvider, createNamespace = true, chartVersion = "2.12.0" } = args;
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

        const release = new k8s.helm.v3.Release(`${name}-flux`, {
            chart: "flux2",
            version: chartVersion,
            repositoryOpts: {
                repo: "oci://ghcr.io/fluxcd/charts",
            },
            namespace: namespaceName,
            createNamespace,
            skipCrds: false,
            values: {
                installCRDs: true,
                components: [
                    "source-controller",
                    "kustomize-controller",
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
                url: cluster.gitops.repositoryUrl,
                ref: {
                    branch: cluster.gitops.branch,
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: release });

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
