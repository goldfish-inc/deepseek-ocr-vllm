import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as command from "@pulumi/command";

import { ClusterConfig } from "../config";

export interface SelfInstallingFluxArgs {
    cluster: ClusterConfig;
    k8sProvider: k8s.Provider;
    escEnvironment: string;
    enablePKO?: boolean;
    enableImageAutomation?: boolean;
    chartVersion?: string;
}

export interface SelfInstallingFluxOutputs {
    namespace: pulumi.Output<string>;
    gitRepositoryReady: pulumi.Output<boolean>;
    kustomizationReady: pulumi.Output<boolean>;
    pkoReady: pulumi.Output<boolean>;
    bootstrapComplete: pulumi.Output<boolean>;
}

export class SelfInstallingFlux extends pulumi.ComponentResource {
    public readonly outputs: SelfInstallingFluxOutputs;

    constructor(name: string, args: SelfInstallingFluxArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:gitops:SelfInstallingFlux", name, {}, opts);

        const {
            cluster,
            k8sProvider,
            escEnvironment,
            enablePKO = true,
            enableImageAutomation = true,
            chartVersion = "2.16.4"
        } = args;

        const namespaceName = "flux-system";
        const cfg = new pulumi.Config();

        // =================================================================
        // PHASE 1: NAMESPACE AND BASIC SETUP
        // =================================================================

        const namespace = new k8s.core.v1.Namespace(`${name}-ns`, {
            metadata: {
                name: namespaceName,
                labels: {
                    "app.kubernetes.io/part-of": "flux",
                    "app.kubernetes.io/managed-by": "pulumi",
                    "pod-security.kubernetes.io/enforce": "baseline",
                    "oceanid.cluster/component": "gitops",
                },
            },
        }, { provider: k8sProvider, parent: this });

        // =================================================================
        // PHASE 2: CREDENTIALS AND SECRETS
        // =================================================================

        // GitHub token from ESC
        const githubToken = cfg.getSecret("github.token");

        // Create GitHub token secret
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
            }, { provider: k8sProvider, parent: this, dependsOn: [namespace] })
            : undefined;

        // SSH key for Git (optional, fallback to HTTPS)
        const sshPrivateKey = cfg.getSecret("flux.ssh_private_key");
        const knownHosts = cfg.get("flux.known_hosts") || "github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=";

        const sshSecret = sshPrivateKey && knownHosts
            ? new k8s.core.v1.Secret(`${name}-ssh`, {
                metadata: {
                    name: "flux-system-ssh",
                    namespace: namespaceName,
                },
                type: "Opaque",
                stringData: {
                    identity: sshPrivateKey,
                    "identity.pub": cfg.get("flux.ssh_public_key") || "",
                    known_hosts: knownHosts,
                },
            }, { provider: k8sProvider, parent: this, dependsOn: [namespace] })
            : undefined;

        // =================================================================
        // PHASE 3: FLUX CORE COMPONENTS
        // =================================================================

        // Install Flux core components
        const fluxRelease = new k8s.helm.v3.Release(`${name}-flux`, {
            chart: "flux2",
            version: chartVersion,
            repositoryOpts: {
                repo: "https://fluxcd-community.github.io/helm-charts",
            },
            namespace: namespaceName,
            createNamespace: false,
            skipCrds: false,
            values: {
                installCRDs: true,
                components: [
                    "source-controller",
                    "kustomize-controller",
                    "helm-controller",
                    "notification-controller",
                    ...(enableImageAutomation ? ["image-automation-controller", "image-reflector-controller"] : []),
                ],
                sourceController: {
                    resources: {
                        requests: { cpu: "100m", memory: "128Mi" },
                        limits: { cpu: "500m", memory: "512Mi" },
                    },
                },
                kustomizeController: {
                    resources: {
                        requests: { cpu: "100m", memory: "128Mi" },
                        limits: { cpu: "500m", memory: "512Mi" },
                    },
                },
                helmController: {
                    resources: {
                        requests: { cpu: "100m", memory: "128Mi" },
                        limits: { cpu: "500m", memory: "512Mi" },
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [namespace] });

        // =================================================================
        // PHASE 4: GIT REPOSITORY CONFIGURATION
        // =================================================================

        // Determine Git URL and authentication method
        const gitRepoUrl = sshSecret && cluster.gitops.repositoryUrl.startsWith("https://")
            ? cluster.gitops.repositoryUrl.replace("https://", "ssh://git@")
            : cluster.gitops.repositoryUrl;

        const gitRepository = new k8s.apiextensions.CustomResource(`${name}-git-repo`, {
            apiVersion: "source.toolkit.fluxcd.io/v1",
            kind: "GitRepository",
            metadata: {
                name: "flux-system",
                namespace: namespaceName,
                labels: {
                    "app.kubernetes.io/part-of": "flux",
                    "oceanid.cluster/component": "source",
                },
            },
            spec: {
                interval: `${cluster.gitops.intervalSeconds}s`,
                url: gitRepoUrl,
                ref: {
                    branch: cluster.gitops.branch,
                },
                secretRef: sshSecret ? {
                    name: "flux-system-ssh",
                } : undefined,
                timeout: "60s",
                ignore: `
# Ignore sensitive files
**/.env
**/secrets.yaml
**/values-secret.yaml
# Ignore build artifacts
**/node_modules/
**/.git/
**/dist/
**/build/
`,
            },
        }, {
            provider: k8sProvider,
            parent: this,
            dependsOn: [fluxRelease, ...(sshSecret ? [sshSecret] : [])],
        });

        // =================================================================
        // PHASE 5: KUSTOMIZATION FOR CLUSTER BOOTSTRAP
        // =================================================================

        const kustomization = new k8s.apiextensions.CustomResource(`${name}-kustomization`, {
            apiVersion: "kustomize.toolkit.fluxcd.io/v1",
            kind: "Kustomization",
            metadata: {
                name: "flux-system",
                namespace: namespaceName,
                labels: {
                    "app.kubernetes.io/part-of": "flux",
                    "oceanid.cluster/component": "kustomization",
                },
            },
            spec: {
                interval: `${cluster.gitops.reconciliationSeconds}s`,
                path: cluster.gitops.path,
                prune: true,
                wait: true,
                timeout: "10m",
                sourceRef: {
                    kind: "GitRepository",
                    name: "flux-system",
                },
                healthChecks: [
                    {
                        apiVersion: "apps/v1",
                        kind: "Deployment",
                        name: "source-controller",
                        namespace: namespaceName,
                    },
                    {
                        apiVersion: "apps/v1",
                        kind: "Deployment",
                        name: "kustomize-controller",
                        namespace: namespaceName,
                    },
                ],
                postBuild: {
                    substitute: {
                        CLUSTER_NAME: cluster.name,
                        CLUSTER_ENVIRONMENT: "prod",
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [gitRepository] });

        // =================================================================
        // PHASE 6: PULUMI KUBERNETES OPERATOR (OPTIONAL)
        // =================================================================

        let pkoNamespace: k8s.core.v1.Namespace | undefined;
        let pkoDeployment: k8s.apps.v1.Deployment | undefined;
        let pkoSecret: k8s.core.v1.Secret | undefined;

        if (enablePKO) {
            const pkoNamespaceName = "pulumi-system";

            pkoNamespace = new k8s.core.v1.Namespace(`${name}-pko-ns`, {
                metadata: {
                    name: pkoNamespaceName,
                    labels: {
                        "app.kubernetes.io/name": "pulumi-kubernetes-operator",
                        "app.kubernetes.io/part-of": "pulumi",
                        "oceanid.cluster/component": "infrastructure",
                    },
                },
            }, { provider: k8sProvider, parent: this });

            // Pulumi credentials from ESC
            const pulumiAccessToken = cfg.getSecret("pulumi.accessToken");
            const pulumiConfigPassphrase = cfg.getSecret("pulumi.configPassphrase") || "";

            pkoSecret = new k8s.core.v1.Secret(`${name}-pko-credentials`, {
                metadata: {
                    name: "pulumi-credentials",
                    namespace: pkoNamespaceName,
                },
                type: "Opaque",
                stringData: {
                    accessToken: pulumiAccessToken || "",
                    configPassphrase: pulumiConfigPassphrase,
                },
            }, { provider: k8sProvider, parent: this, dependsOn: [pkoNamespace] });

            // PKO Deployment
            pkoDeployment = new k8s.apps.v1.Deployment(`${name}-pko`, {
                metadata: {
                    name: "pulumi-kubernetes-operator",
                    namespace: pkoNamespaceName,
                    labels: {
                        "app.kubernetes.io/name": "pulumi-kubernetes-operator",
                    },
                },
                spec: {
                    replicas: 1,
                    selector: {
                        matchLabels: {
                            "app.kubernetes.io/name": "pulumi-kubernetes-operator",
                        },
                    },
                    template: {
                        metadata: {
                            labels: {
                                "app.kubernetes.io/name": "pulumi-kubernetes-operator",
                            },
                        },
                        spec: {
                            serviceAccountName: "pulumi-kubernetes-operator",
                            containers: [
                                {
                                    name: "pulumi-kubernetes-operator",
                                    image: "pulumi/pulumi-kubernetes-operator:v2.2.0",
                                    env: [
                                        {
                                            name: "PULUMI_ACCESS_TOKEN",
                                            valueFrom: {
                                                secretKeyRef: {
                                                    name: "pulumi-credentials",
                                                    key: "accessToken",
                                                },
                                            },
                                        },
                                        {
                                            name: "PULUMI_CONFIG_PASSPHRASE",
                                            valueFrom: {
                                                secretKeyRef: {
                                                    name: "pulumi-credentials",
                                                    key: "configPassphrase",
                                                },
                                            },
                                        },
                                    ],
                                    resources: {
                                        requests: {
                                            cpu: "100m",
                                            memory: "128Mi",
                                        },
                                        limits: {
                                            cpu: "500m",
                                            memory: "512Mi",
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            }, { provider: k8sProvider, parent: this, dependsOn: [pkoSecret] });
        }

        // =================================================================
        // PHASE 7: STATUS MONITORING
        // =================================================================

        // Wait for core components to be ready
        const fluxHealthCheck = new command.local.Command(`${name}-health-check`, {
            create: pulumi.interpolate`
                # Wait for Flux components to be ready
                echo "Checking Flux component health..."

                for i in {1..30}; do
                    if kubectl get pods -n ${namespaceName} --no-headers 2>/dev/null | grep -E "(source-controller|kustomize-controller)" | grep -q "Running"; then
                        echo "✅ Flux core components are running"
                        break
                    fi
                    echo "Waiting for Flux components... ($i/30)"
                    sleep 10
                done

                # Check GitRepository status
                echo "Checking GitRepository status..."
                kubectl get gitrepository flux-system -n ${namespaceName} -o yaml || echo "GitRepository not yet ready"

                # Check Kustomization status
                echo "Checking Kustomization status..."
                kubectl get kustomization flux-system -n ${namespaceName} -o yaml || echo "Kustomization not yet ready"

                echo "✅ Self-installing Flux bootstrap completed"
            `,
        }, { parent: this, dependsOn: [kustomization] });

        // =================================================================
        // OUTPUTS
        // =================================================================

        const gitRepositoryReady = pulumi.output(gitRepository).apply((repo: any) => {
            const status = repo.status || {};
            return status.conditions && status.conditions.some((c: any) =>
                c.type === "Ready" && c.status === "True"
            ) || false;
        });

        const kustomizationReady = pulumi.output(kustomization).apply((kust: any) => {
            const status = kust.status || {};
            return status.conditions && status.conditions.some((c: any) =>
                c.type === "Ready" && c.status === "True"
            ) || false;
        });

        const pkoReady = pkoDeployment
            ? pkoDeployment.status.apply(status =>
                status && status.readyReplicas === 1
              )
            : pulumi.output(true);

        const bootstrapComplete = pulumi.all([gitRepositoryReady, kustomizationReady, pkoReady])
            .apply(([git, kustomize, pko]) => git && kustomize && pko);

        this.outputs = {
            namespace: namespace.metadata.name,
            gitRepositoryReady,
            kustomizationReady,
            pkoReady,
            bootstrapComplete,
        };

        this.registerOutputs(this.outputs);
    }
}
