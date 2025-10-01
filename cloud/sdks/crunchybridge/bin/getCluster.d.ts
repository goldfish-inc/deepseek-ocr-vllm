import * as pulumi from "@pulumi/pulumi";
export declare function getCluster(args: GetClusterArgs, opts?: pulumi.InvokeOptions): Promise<GetClusterResult>;
/**
 * A collection of arguments for invoking getCluster.
 */
export interface GetClusterArgs {
    id: string;
}
/**
 * A collection of values returned by getCluster.
 */
export interface GetClusterResult {
    readonly cpu: number;
    readonly createdAt: string;
    readonly id: string;
    readonly isHa: boolean;
    readonly maintenanceWindowStart: number;
    readonly memory: number;
    readonly name: string;
    readonly planId: string;
    readonly postgresVersionId: number;
    readonly providerId: string;
    readonly regionId: string;
    readonly storage: number;
    readonly teamId: string;
    readonly updatedAt: string;
}
export declare function getClusterOutput(args: GetClusterOutputArgs, opts?: pulumi.InvokeOutputOptions): pulumi.Output<GetClusterResult>;
/**
 * A collection of arguments for invoking getCluster.
 */
export interface GetClusterOutputArgs {
    id: pulumi.Input<string>;
}
