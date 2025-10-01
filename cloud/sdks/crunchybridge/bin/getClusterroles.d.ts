import * as pulumi from "@pulumi/pulumi";
import * as outputs from "./types/output";
export declare function getClusterroles(args: GetClusterrolesArgs, opts?: pulumi.InvokeOptions): Promise<GetClusterrolesResult>;
/**
 * A collection of arguments for invoking getClusterroles.
 */
export interface GetClusterrolesArgs {
    id: string;
}
/**
 * A collection of values returned by getClusterroles.
 */
export interface GetClusterrolesResult {
    readonly application: {
        [key: string]: string;
    };
    readonly id: string;
    readonly superuser: {
        [key: string]: string;
    };
    readonly userRoles: outputs.GetClusterrolesUserRole[];
}
export declare function getClusterrolesOutput(args: GetClusterrolesOutputArgs, opts?: pulumi.InvokeOutputOptions): pulumi.Output<GetClusterrolesResult>;
/**
 * A collection of arguments for invoking getClusterroles.
 */
export interface GetClusterrolesOutputArgs {
    id: pulumi.Input<string>;
}
