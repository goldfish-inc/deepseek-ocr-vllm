import * as pulumi from "@pulumi/pulumi";
import * as outputs from "./types/output";
export declare function getCloudprovider(args: GetCloudproviderArgs, opts?: pulumi.InvokeOptions): Promise<GetCloudproviderResult>;
/**
 * A collection of arguments for invoking getCloudprovider.
 */
export interface GetCloudproviderArgs {
    id?: string;
    providerId: string;
}
/**
 * A collection of values returned by getCloudprovider.
 */
export interface GetCloudproviderResult {
    readonly id: string;
    readonly plans: outputs.GetCloudproviderPlan[];
    readonly providerId: string;
    readonly regions: outputs.GetCloudproviderRegion[];
}
export declare function getCloudproviderOutput(args: GetCloudproviderOutputArgs, opts?: pulumi.InvokeOutputOptions): pulumi.Output<GetCloudproviderResult>;
/**
 * A collection of arguments for invoking getCloudprovider.
 */
export interface GetCloudproviderOutputArgs {
    id?: pulumi.Input<string>;
    providerId: pulumi.Input<string>;
}
