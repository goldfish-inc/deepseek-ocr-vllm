import * as pulumi from "@pulumi/pulumi";
export declare class Cluster extends pulumi.CustomResource {
    /**
     * Get an existing Cluster resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param state Any extra arguments used during the lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    static get(name: string, id: pulumi.Input<pulumi.ID>, state?: ClusterState, opts?: pulumi.CustomResourceOptions): Cluster;
    /**
     * Returns true if the given object is an instance of Cluster.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    static isInstance(obj: any): obj is Cluster;
    /**
     * The number of CPU units on the cluster's instance
     */
    readonly cpu: pulumi.Output<number>;
    /**
     * Creation time formatted as [RFC 3339](https://datatracker.ietf.org/doc/html/rfc3339).
     */
    readonly createdAt: pulumi.Output<string>;
    /**
     * Whether the cluster is high availability, meaning that it has a secondary it can fail over to quickly in case the primary becomes unavailable. Defaults to `false`
     */
    readonly isHa: pulumi.Output<boolean | undefined>;
    /**
     * The hour of day which a maintenance window can possibly start. This should be an integer from `0` to `23` representing the hour of day which maintenance is allowed to start, with `0` representing midnight UTC. Maintenance windows are typically three hours long starting from this hour. A `null` value means that no explicit maintenance window has been set and that maintenance is allowed to occur at any time.
     */
    readonly maintenanceWindowStart: pulumi.Output<number>;
    /**
     * The cluster's major Postgres version. For example, `16`. Defaults to [Create Cluster](https://docs.crunchybridge.com/api/cluster/#create-cluster) defaults.
     */
    readonly majorVersion: pulumi.Output<number | undefined>;
    /**
     * The total amount of memory available on the cluster's instance in GB (gigabytes).
     */
    readonly memory: pulumi.Output<number>;
    /**
     * A human-readable name for the cluster.
     */
    readonly name: pulumi.Output<string>;
    /**
     * The ID of the [cluster's plan](https://docs.crunchybridge.com/concepts/plans-pricing/). Determines instance, CPU, and memory. Defaults to `hobby-2`.
     */
    readonly planId: pulumi.Output<string | undefined>;
    /**
     * The [cloud provider](https://docs.crunchybridge.com/api/provider) where the cluster is located. Defaults to `aws`, allows `aws`, `gcp`, or `azure`
     */
    readonly providerId: pulumi.Output<string | undefined>;
    /**
     * The [provider region](https://docs.crunchybridge.com/api/provider#region) where the cluster is located. Defaults to `us-west-1`
     */
    readonly regionId: pulumi.Output<string | undefined>;
    /**
     * The amount of storage available to the cluster in GB (gigabytes). Defaults to 100.
     */
    readonly storage: pulumi.Output<number | undefined>;
    /**
     * The ID of the parent [team](https://docs.crunchybridge.com/concepts/teams/) for the cluster.
     */
    readonly teamId: pulumi.Output<string>;
    /**
     * Time at which the cluster was last updated formatted as [RFC 3339](https://datatracker.ietf.org/doc/html/rfc3339).
     */
    readonly updatedAt: pulumi.Output<string>;
    /**
     * Treats the create operation as incomplete until the cluster reports a ready status. Defaults to `false`
     */
    readonly waitUntilReady: pulumi.Output<boolean | undefined>;
    /**
     * Create a Cluster resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args: ClusterArgs, opts?: pulumi.CustomResourceOptions);
}
/**
 * Input properties used for looking up and filtering Cluster resources.
 */
export interface ClusterState {
    /**
     * The number of CPU units on the cluster's instance
     */
    cpu?: pulumi.Input<number>;
    /**
     * Creation time formatted as [RFC 3339](https://datatracker.ietf.org/doc/html/rfc3339).
     */
    createdAt?: pulumi.Input<string>;
    /**
     * Whether the cluster is high availability, meaning that it has a secondary it can fail over to quickly in case the primary becomes unavailable. Defaults to `false`
     */
    isHa?: pulumi.Input<boolean>;
    /**
     * The hour of day which a maintenance window can possibly start. This should be an integer from `0` to `23` representing the hour of day which maintenance is allowed to start, with `0` representing midnight UTC. Maintenance windows are typically three hours long starting from this hour. A `null` value means that no explicit maintenance window has been set and that maintenance is allowed to occur at any time.
     */
    maintenanceWindowStart?: pulumi.Input<number>;
    /**
     * The cluster's major Postgres version. For example, `16`. Defaults to [Create Cluster](https://docs.crunchybridge.com/api/cluster/#create-cluster) defaults.
     */
    majorVersion?: pulumi.Input<number>;
    /**
     * The total amount of memory available on the cluster's instance in GB (gigabytes).
     */
    memory?: pulumi.Input<number>;
    /**
     * A human-readable name for the cluster.
     */
    name?: pulumi.Input<string>;
    /**
     * The ID of the [cluster's plan](https://docs.crunchybridge.com/concepts/plans-pricing/). Determines instance, CPU, and memory. Defaults to `hobby-2`.
     */
    planId?: pulumi.Input<string>;
    /**
     * The [cloud provider](https://docs.crunchybridge.com/api/provider) where the cluster is located. Defaults to `aws`, allows `aws`, `gcp`, or `azure`
     */
    providerId?: pulumi.Input<string>;
    /**
     * The [provider region](https://docs.crunchybridge.com/api/provider#region) where the cluster is located. Defaults to `us-west-1`
     */
    regionId?: pulumi.Input<string>;
    /**
     * The amount of storage available to the cluster in GB (gigabytes). Defaults to 100.
     */
    storage?: pulumi.Input<number>;
    /**
     * The ID of the parent [team](https://docs.crunchybridge.com/concepts/teams/) for the cluster.
     */
    teamId?: pulumi.Input<string>;
    /**
     * Time at which the cluster was last updated formatted as [RFC 3339](https://datatracker.ietf.org/doc/html/rfc3339).
     */
    updatedAt?: pulumi.Input<string>;
    /**
     * Treats the create operation as incomplete until the cluster reports a ready status. Defaults to `false`
     */
    waitUntilReady?: pulumi.Input<boolean>;
}
/**
 * The set of arguments for constructing a Cluster resource.
 */
export interface ClusterArgs {
    /**
     * Whether the cluster is high availability, meaning that it has a secondary it can fail over to quickly in case the primary becomes unavailable. Defaults to `false`
     */
    isHa?: pulumi.Input<boolean>;
    /**
     * The cluster's major Postgres version. For example, `16`. Defaults to [Create Cluster](https://docs.crunchybridge.com/api/cluster/#create-cluster) defaults.
     */
    majorVersion?: pulumi.Input<number>;
    /**
     * A human-readable name for the cluster.
     */
    name?: pulumi.Input<string>;
    /**
     * The ID of the [cluster's plan](https://docs.crunchybridge.com/concepts/plans-pricing/). Determines instance, CPU, and memory. Defaults to `hobby-2`.
     */
    planId?: pulumi.Input<string>;
    /**
     * The [cloud provider](https://docs.crunchybridge.com/api/provider) where the cluster is located. Defaults to `aws`, allows `aws`, `gcp`, or `azure`
     */
    providerId?: pulumi.Input<string>;
    /**
     * The [provider region](https://docs.crunchybridge.com/api/provider#region) where the cluster is located. Defaults to `us-west-1`
     */
    regionId?: pulumi.Input<string>;
    /**
     * The amount of storage available to the cluster in GB (gigabytes). Defaults to 100.
     */
    storage?: pulumi.Input<number>;
    /**
     * The ID of the parent [team](https://docs.crunchybridge.com/concepts/teams/) for the cluster.
     */
    teamId: pulumi.Input<string>;
    /**
     * Treats the create operation as incomplete until the cluster reports a ready status. Defaults to `false`
     */
    waitUntilReady?: pulumi.Input<boolean>;
}
