import * as pulumi from "@pulumi/pulumi";
export declare function getClusterids(args?: GetClusteridsArgs, opts?: pulumi.InvokeOptions): Promise<GetClusteridsResult>;
/**
 * A collection of arguments for invoking getClusterids.
 */
export interface GetClusteridsArgs {
    id?: string;
    teamId?: string;
}
/**
 * A collection of values returned by getClusterids.
 */
export interface GetClusteridsResult {
    readonly clusterIdsByName: {
        [key: string]: string;
    };
    readonly id: string;
    readonly teamId?: string;
}
export declare function getClusteridsOutput(args?: GetClusteridsOutputArgs, opts?: pulumi.InvokeOutputOptions): pulumi.Output<GetClusteridsResult>;
/**
 * A collection of arguments for invoking getClusterids.
 */
export interface GetClusteridsOutputArgs {
    id?: pulumi.Input<string>;
    teamId?: pulumi.Input<string>;
}
