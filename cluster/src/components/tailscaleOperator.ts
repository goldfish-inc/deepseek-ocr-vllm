import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";

export interface TailscaleOperatorArgs {
  namespace: string;
  oauthClientId: pulumi.Input<string>;
  oauthClientSecret: pulumi.Input<string>;
  k8sProvider?: kubernetes.Provider;
}

export class TailscaleOperator extends pulumi.ComponentResource {
  public readonly namespace: kubernetes.core.v1.Namespace;
  public readonly release: kubernetes.helm.v3.Release;

  constructor(name: string, args: TailscaleOperatorArgs, opts?: pulumi.ComponentResourceOptions) {
    super("oceanid:tailscale:Operator", name, {}, opts);

    // Create namespace
    this.namespace = new kubernetes.core.v1.Namespace(
      `${name}-namespace`,
      {
        metadata: { name: args.namespace },
      },
      { parent: this, provider: args.k8sProvider }
    );

    // Deploy Tailscale Operator via Helm
    this.release = new kubernetes.helm.v3.Release(
      `${name}-helm`,
      {
        chart: "tailscale-operator",
        version: "1.76.1", // Check latest: https://github.com/tailscale/tailscale/pkgs/container/tailscale-operator
        namespace: args.namespace,
        repositoryOpts: {
          repo: "https://pkgs.tailscale.com/helmcharts",
        },
        values: {
          oauth: {
            clientId: args.oauthClientId,
            clientSecret: args.oauthClientSecret,
          },
          operatorConfig: {
            hostname: "oceanid-operator",
          },
        },
        timeout: 600, // 10 minutes for operator to authenticate and become ready
        cleanupOnFail: true, // Clean up resources if deployment fails
      },
      {
        parent: this,
        provider: args.k8sProvider,
        dependsOn: [this.namespace],
        deleteBeforeReplace: true, // Force full recreation on conflicts
      }
    );

    this.registerOutputs({});
  }
}
