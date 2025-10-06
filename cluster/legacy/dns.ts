import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { config } from "./index";

// =============================================================================
// DNS CONFIGURATION FOR BOATHOU.SE - OCEANID INFRASTRUCTURE
// =============================================================================

// Cloudflare provider using API token from ESC
const cloudflareProvider = new cloudflare.Provider("cloudflare-provider", {
    apiToken: config.requireSecret("cloudflare_api_token")
});

// Zone data for boathou.se
const boathouseZone = cloudflare.getZone({
    name: "boathou.se"
}, { provider: cloudflareProvider });

// Tunnel CNAME target
const tunnelId = config.require("cloudflare_tunnel_id");
const tunnelCname = `${tunnelId}.cfargotunnel.com`;

// Service endpoints
const services = [
    "health",
    "dashboard",
    "metrics",
    "vault"
];

// Oceanid node names
const nodes = [
    "tethys",
    "styx",
    "meliae",
    "calypso"
];

// Create CNAME records for services
export const serviceDnsRecords = services.map(service =>
    new cloudflare.Record(`${service}-boathouse`, {
        zoneId: boathouseZone.then(z => z.id),
        name: service,
        type: "CNAME",
        value: tunnelCname,
        ttl: 1,
        proxied: true,
        comment: `Oceanid cluster - ${service} service`
    }, { provider: cloudflareProvider })
);

// Create CNAME records for nodes
export const nodeDnsRecords = nodes.map(node =>
    new cloudflare.Record(`${node}-boathouse`, {
        zoneId: boathouseZone.then(z => z.id),
        name: node,
        type: "CNAME",
        value: tunnelCname,
        ttl: 1,
        proxied: true,
        comment: `Oceanid cluster - ${node} node`
    }, { provider: cloudflareProvider })
);

// Export DNS configuration status
export const dnsStatus = {
    domain: "boathou.se",
    tunnelId: tunnelId,
    services: services.map(s => `${s}.boathou.se`),
    nodes: nodes.map(n => `${n}.boathou.se`)
};
