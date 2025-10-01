import * as pulumi from "@pulumi/pulumi";
import * as outputs from "./types/output";
export declare function getClusterstatus(args: GetClusterstatusArgs, opts?: pulumi.InvokeOptions): Promise<GetClusterstatusResult>;
/**
 * A collection of arguments for invoking getClusterstatus.
 */
export interface GetClusterstatusArgs {
    id: string;
}
/**
 * A collection of values returned by getClusterstatus.
 */
export interface GetClusterstatusResult {
    readonly diskAvailableMb: number;
    readonly diskTotalSizeMb: number;
    readonly diskUsedMb: number;
    readonly id: string;
    readonly oldestBackup: string;
    readonly operations: outputs.GetClusterstatusOperation[];
    readonly state: string;
}
export declare function getClusterstatusOutput(args: GetClusterstatusOutputArgs, opts?: pulumi.InvokeOutputOptions): pulumi.Output<GetClusterstatusResult>;
/**
 * A collection of arguments for invoking getClusterstatus.
 */
export interface GetClusterstatusOutputArgs {
    id: pulumi.Input<string>;
}
