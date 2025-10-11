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
  public readonly release: kubernetes.helm.v4.Chart;

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

    // Deploy Tailscale Operator via Helm v4 Chart (better lifecycle management)
    this.release = new kubernetes.helm.v4.Chart(
      `${name}-chart`,
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
      },
      {
        parent: this,
        provider: args.k8sProvider,
        dependsOn: [this.namespace],
      }
    );

    this.registerOutputs({});
  }
}
