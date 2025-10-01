import * as pulumi from "@pulumi/pulumi";
/**
 * The provider type for the crunchybridge package. By default, resources use package-wide configuration
 * settings, however an explicit `Provider` instance may be created and passed during resource
 * construction to achieve fine-grained programmatic control over provider settings. See the
 * [documentation](https://www.pulumi.com/docs/reference/programming-model/#providers) for more information.
 */
export declare class Provider extends pulumi.ProviderResource {
    /**
     * Returns true if the given object is an instance of Provider.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    static isInstance(obj: any): obj is Provider;
    /**
     * The application id component of the Crunchy Bridge API key. (deprecated)
     */
    readonly applicationId: pulumi.Output<string | undefined>;
    /**
     * The application secret component of the Crunchy Bridge API key.
     */
    readonly applicationSecret: pulumi.Output<string>;
    /**
     * The API URL for the Crunchy Bridge platform API. Most users should not need to change this value.
     */
    readonly bridgeapiUrl: pulumi.Output<string | undefined>;
    /**
     * Create a Provider resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args: ProviderArgs, opts?: pulumi.ResourceOptions);
    /**
     * This function returns a Terraform config object with terraform-namecased keys,to be used with the Terraform Module Provider.
     */
    terraformConfig(): pulumi.Output<{
        [key: string]: any;
    }>;
}
/**
 * The set of arguments for constructing a Provider resource.
 */
export interface ProviderArgs {
    /**
     * The application id component of the Crunchy Bridge API key. (deprecated)
     */
    applicationId?: pulumi.Input<string>;
    /**
     * The application secret component of the Crunchy Bridge API key.
     */
    applicationSecret: pulumi.Input<string>;
    /**
     * The API URL for the Crunchy Bridge platform API. Most users should not need to change this value.
     */
    bridgeapiUrl?: pulumi.Input<string>;
    /**
     * When true, forces an exchange of the API key for a short-lived bearer token.
     */
    requireTokenSwap?: pulumi.Input<boolean>;
}
export declare namespace Provider {
    /**
     * The results of the Provider.terraformConfig method.
     */
    interface TerraformConfigResult {
        readonly result: {
            [key: string]: any;
        };
    }
}
