import * as pulumi from "@pulumi/pulumi";
import * as crunchybridge from "@pulumi/crunchybridge";

export interface CrunchyBridgeClusterArgs {
  /**
   * CrunchyBridge application ID for API authentication
   */
  applicationId: pulumi.Input<string>;

  /**
   * CrunchyBridge application secret for API authentication
   */
  applicationSecret: pulumi.Input<string>;

  /**
   * Cluster name (e.g., "ebisu")
   */
  name: string;

  /**
   * Cloud provider: "aws", "gcp", or "azure"
   */
  provider: "aws" | "gcp" | "azure";

  /**
   * Cloud region (e.g., "us-east-2")
   */
  region: string;

  /**
   * Plan ID (e.g., "hobby-2" for 4GB RAM, 1 vCPU, 50GB storage)
   * See: https://docs.crunchybridge.com/concepts/plan
   */
  planId: string;

  /**
   * PostgreSQL major version (e.g., 17)
   */
  majorVersion: number;

  /**
   * Storage size in GB
   */
  storage: number;

  /**
   * Enable high availability (multi-node cluster)
   */
  isHa: boolean;

  /**
   * Team ID for the cluster (from CrunchyBridge account)
   */
  teamId: pulumi.Input<string>;
}

export interface CrunchyBridgeClusterOutputs {
  /**
   * Cluster ID
   */
  clusterId: pulumi.Output<string>;

  /**
   * Connection string for the database
   */
  connectionUrl: pulumi.Output<string>;

  /**
   * Cluster status
   */
  status: pulumi.Output<string>;

  /**
   * Cluster endpoint hostname
   */
  host: pulumi.Output<string>;
}

/**
 * CrunchyBridge managed PostgreSQL cluster
 *
 * Provisions a fully managed PostgreSQL database via CrunchyBridge
 * using Infrastructure as Code. No manual provisioning or drift.
 */
export class CrunchyBridgeCluster extends pulumi.ComponentResource {
  public readonly outputs: CrunchyBridgeClusterOutputs;

  constructor(
    name: string,
    args: CrunchyBridgeClusterArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("oceanid:db:CrunchyBridgeCluster", name, {}, opts);

    // Create CrunchyBridge provider with API credentials
    const cbProvider = new crunchybridge.Provider(
      `${name}-provider`,
      {
        applicationId: args.applicationId,
        applicationSecret: args.applicationSecret,
      },
      { parent: this }
    );

    // Create the managed PostgreSQL cluster
    const cluster = new crunchybridge.Cluster(
      `${name}-cluster`,
      {
        teamId: args.teamId,
        name: args.name,
        providerId: args.provider,
        regionId: args.region,
        planId: args.planId,
        isHa: args.isHa,
        storage: args.storage,
        majorVersion: args.majorVersion,
        waitUntilReady: true, // Block until cluster is ready
      },
      { provider: cbProvider, parent: this }
    );

    // Query cluster status to get state
    const clusterStatus = cluster.id.apply((id) =>
      crunchybridge.getClusterstatus({ id }, { provider: cbProvider })
    );

    // Build connection URL from cluster details
    // CrunchyBridge uses: postgres://application:password@p.<cluster-id>.db.postgresbridge.com:5432/postgres
    // The provider manages credentials internally, but we need to fetch them via cb CLI or API
    // For now, output the cluster ID and let users retrieve the URL via `cb uri <id>`
    const connectionUrl = pulumi.interpolate`postgres://application:<password>@p.${cluster.id}.db.postgresbridge.com:5432/postgres`;

    this.outputs = {
      clusterId: cluster.id,
      connectionUrl: pulumi.secret(connectionUrl), // Placeholder - real credentials from cb CLI
      status: clusterStatus.apply((s) => s.state),
      host: pulumi.interpolate`p.${cluster.id}.db.postgresbridge.com`,
    };

    this.registerOutputs({
      clusterId: this.outputs.clusterId,
      connectionUrl: this.outputs.connectionUrl,
      status: this.outputs.status,
      host: this.outputs.host,
    });
  }
}
