import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

export interface CloudflareDnsArgs {
    zoneId: string;
}

/**
 * Cloudflare DNS records for boathou.se domain
 *
 * Manages CNAME records pointing to Cloudflare Tunnel endpoints
 */
export class CloudflareDns extends pulumi.ComponentResource {
    public readonly k3sCname: cloudflare.Record;
    public readonly gpuCname: cloudflare.Record;

    constructor(name: string, args: CloudflareDnsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:cloudflare:Dns", name, {}, opts);

        // k3s control plane tunnel (tethys)
        this.k3sCname = new cloudflare.Record("k3s-cname", {
            zoneId: args.zoneId,
            name: "k3s",
            type: "CNAME",
            content: "6ff4dfd7-2b77-4a4f-84d9-3241bea658dc.cfargotunnel.com",
            proxied: true,
            ttl: 1, // Auto TTL when proxied
        }, { parent: this, protect: true });

        // gpu node tunnel (calypso)
        this.gpuCname = new cloudflare.Record("gpu-cname", {
            zoneId: args.zoneId,
            name: "gpu",
            type: "CNAME",
            content: "a8062deb-9d69-4445-8368-2d9565bba8c2.cfargotunnel.com",
            proxied: true,
            ttl: 1,
        }, { parent: this, protect: true });

        this.registerOutputs({});
    }
}
