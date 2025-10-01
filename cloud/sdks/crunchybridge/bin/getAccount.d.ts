import * as pulumi from "@pulumi/pulumi";
import * as outputs from "./types/output";
export declare function getAccount(opts?: pulumi.InvokeOptions): Promise<GetAccountResult>;
/**
 * A collection of values returned by getAccount.
 */
export interface GetAccountResult {
    readonly defaultTeam: string;
    readonly id: string;
    readonly personalTeam: string;
    readonly teamMemberships: outputs.GetAccountTeamMembership[];
}
export declare function getAccountOutput(opts?: pulumi.InvokeOutputOptions): pulumi.Output<GetAccountResult>;
