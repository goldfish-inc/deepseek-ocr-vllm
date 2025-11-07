import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";

export interface TailscaleSubnetRouterArgs {
  namespace: string;
  authKey: pulumi.Input<string>;
  routes: string[]; // e.g. ["10.42.0.0/16", "10.43.0.0/16"]
  advertiseExitNode: boolean;
  acceptDNS: boolean;
  nodeSelectorKey?: string; // e.g. "kubernetes.io/hostname"
  nodeSelectorValue?: string; // e.g. "tethys" (pin to specific node)
  k8sProvider?: kubernetes.Provider;
}

export class TailscaleSubnetRouter extends pulumi.ComponentResource {
  public readonly serviceAccount: kubernetes.core.v1.ServiceAccount;
  public readonly deployment: kubernetes.apps.v1.Deployment;
  public readonly service: kubernetes.core.v1.Service;

  constructor(name: string, args: TailscaleSubnetRouterArgs, opts?: pulumi.ComponentResourceOptions) {
    super("oceanid:tailscale:SubnetRouter", name, {}, opts);

    const labels = { app: "tailscale-subnet-router" };

    // Create ServiceAccount for subnet router
    this.serviceAccount = new kubernetes.core.v1.ServiceAccount(
      `${name}-sa`,
      {
        metadata: { name: "tailscale", namespace: args.namespace },
      },
      { parent: this, provider: args.k8sProvider }
    );

    // Create Role for subnet router (secret management permissions)
    const role = new kubernetes.rbac.v1.Role(
      `${name}-role`,
      {
        metadata: { name: "tailscale-subnet-router", namespace: args.namespace },
        rules: [
          {
            apiGroups: [""],
            resources: ["secrets"],
            verbs: ["get", "create", "update", "patch"],
          },
        ],
      },
      { parent: this, provider: args.k8sProvider }
    );

    // Bind Role to ServiceAccount
    const roleBinding = new kubernetes.rbac.v1.RoleBinding(
      `${name}-rolebinding`,
      {
        metadata: { name: "tailscale-subnet-router", namespace: args.namespace },
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: "Role",
          name: "tailscale-subnet-router",
        },
        subjects: [
          {
            kind: "ServiceAccount",
            name: "tailscale",
            namespace: args.namespace,
          },
        ],
      },
      { parent: this, provider: args.k8sProvider, dependsOn: [role, this.serviceAccount] }
    );

    // Deployment with exit node configuration
    this.deployment = new kubernetes.apps.v1.Deployment(
      `${name}-deployment`,
      {
        metadata: { name, namespace: args.namespace },
        spec: {
          replicas: 1, // Single exit node (pinned to tethys)
          selector: { matchLabels: labels },
          template: {
            metadata: {
              labels,
              annotations: {
                "oceanid.dev/rollout-token": "1",
              },
            },
            spec: {
              serviceAccountName: "tailscale",
              initContainers: [
                {
                  name: "sysctler",
                  image: "busybox",
                  securityContext: { privileged: true },
                  command: ["/bin/sh"],
                  args: [
                    "-c",
                    "sysctl -w net.ipv4.ip_forward=1 && sysctl -w net.ipv6.conf.all.forwarding=1",
                  ],
                  resources: {
                    requests: { cpu: "1m", memory: "1Mi" },
                  },
                },
              ],
              containers: [
                {
                  name: "tailscale",
                  imagePullPolicy: "Always",
                  image: "ghcr.io/tailscale/tailscale:latest",
                  env: [
                    {
                      name: "TS_AUTHKEY",
                      value: args.authKey,
                    },
                    {
                      name: "TS_ROUTES",
                      value: args.routes.join(","),
                    },
                    {
                      name: "TS_ACCEPT_DNS",
                      value: args.acceptDNS ? "true" : "false",
                    },
                    {
                      name: "TS_EXTRA_ARGS",
                      value: args.advertiseExitNode ? "--advertise-exit-node" : "",
                    },
                    {
                      name: "TS_KUBE_SECRET",
                      value: "tailscale-subnet-router",
                    },
                    {
                      name: "TS_USERSPACE",
                      value: "false", // Use kernel networking (better performance)
                    },
                  ],
                  securityContext: {
                    capabilities: {
                      add: ["NET_ADMIN"],
                    },
                  },
                  resources: {
                    requests: {
                      cpu: "50m",
                      memory: "50Mi",
                    },
                    limits: {
                      cpu: "100m",
                      memory: "100Mi",
                    },
                  },
                },
              ],
              ...(args.nodeSelectorKey && args.nodeSelectorValue
                ? {
                    nodeSelector: {
                      [args.nodeSelectorKey]: args.nodeSelectorValue,
                    },
                  }
                : {}),
            },
          },
        },
      },
      { parent: this, provider: args.k8sProvider, dependsOn: [this.serviceAccount] }
    );

    // Service for health checks
    this.service = new kubernetes.core.v1.Service(
      `${name}-service`,
      {
        metadata: { name, namespace: args.namespace },
        spec: {
          selector: labels,
          ports: [{ port: 41641, name: "tailscale" }],
        },
      },
      { parent: this, provider: args.k8sProvider }
    );

    this.registerOutputs({});
  }
}
