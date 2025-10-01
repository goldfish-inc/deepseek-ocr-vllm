import * as pulumi from "@pulumi/pulumi";
import * as crunchybridge from "@pulumi/crunchybridge";
import * as cloudflare from "@pulumi/cloudflare";

// =============================================================================
// OCEANID CLOUD INFRASTRUCTURE
// =============================================================================
// This project manages cloud resources only (Cloudflare, CrunchyBridge, ESC)
// NO kubeconfig required - safe to run in GitHub Actions
//
// Cluster resources (Flux, PKO, etc.) are in ../cluster-bootstrap/
// Application resources are managed by Flux GitOps in ../clusters/
// =============================================================================

const cfg = new pulumi.Config();

// =============================================================================
// CRUNCHYBRIDGE POSTGRESQL 17 DATABASE
// =============================================================================

const enableCrunchyBridgeProvisioning = cfg.getBoolean("enableCrunchyBridgeProvisioning") ?? false;
let cluster: crunchybridge.Cluster | undefined;

if (enableCrunchyBridgeProvisioning) {
    // Create CrunchyBridge provider
    const cbProvider = new crunchybridge.Provider("crunchybridge", {
        applicationSecret: cfg.requireSecret("crunchybridge_api_key"),
    });

    // Adopted existing cluster (imported from 3x4xvkn3xza2zjwiklcuonpamy)
    // Using protect=true to prevent accidental deletion
    cluster = new crunchybridge.Cluster("ebisu", {
        teamId: cfg.requireSecret("crunchybridge_team_id"),
        name: "ebisu",
        providerId: "aws",
        regionId: "us-east-2",
        planId: "standard-4",
        isHa: false,
        storage: 50,
        majorVersion: 17,
    }, { provider: cbProvider, protect: true });
}

// Export connection details
export const clusterId: pulumi.Output<string> | undefined = cluster?.id;
export const clusterHost: pulumi.Output<string> | undefined = cluster?.id.apply(id => `p.${id}.db.postgresbridge.com`);
export const clusterStatus: pulumi.Output<string> | undefined = cluster?.id.apply(id =>
    crunchybridge.getClusterstatus({ id }).then(s => s.state)
);
export const connectionUrl: pulumi.Output<string> | undefined = cluster?.id.apply(id =>
    pulumi.secret(`postgres://application:<password>@p.${id}.db.postgresbridge.com:5432/postgres`)
);

// =============================================================================
// CLOUDFLARE DNS
// =============================================================================

const cloudflareZoneId = "a81f75a1931dcac429c50f2ee5252955"; // boathou.se

// k3s control plane tunnel (adopted from existing)
const k3sCname = new cloudflare.Record("k3s-cname", {
    zoneId: cloudflareZoneId,
    name: "k3s.boathou.se",
    type: "CNAME",
    content: "6ff4dfd7-2b77-4a4f-84d9-3241bea658dc.cfargotunnel.com",
    proxied: true,
    ttl: 1,
    comment: "Managed by Pulumi for cluster oceanid-cluster",
}, { protect: true });

// gpu node tunnel (adopted from existing)
const gpuCname = new cloudflare.Record("gpu-cname", {
    zoneId: cloudflareZoneId,
    name: "gpu.boathou.se",
    type: "CNAME",
    content: "a8062deb-9d69-4445-8368-2d9565bba8c2.cfargotunnel.com",
    proxied: true,
    ttl: 1,
    comment: "GPU access for oceanid-cluster host connector",
}, { protect: true });

// =============================================================================
// CLOUDFLARE ACCESS
// =============================================================================

const cloudflareAccountId = "8fa97474778c8a894925c148ca829739";

// Label Studio Access app (adopted from existing)
const labelStudioAccess = new cloudflare.ZeroTrustAccessApplication("label-studio", {
    accountId: cloudflareAccountId,
    name: "Label Studio - Maritime NER",
    autoRedirectToIdentity: true,
    customDenyMessage: "Access restricted to authorized SME annotators.",
    customDenyUrl: "https://boathou.se/access-denied",
    httpOnlyCookieAttribute: true,
    logoUrl: "https://labelstud.io/images/logo.png",
    sessionDuration: "8h",
}, { protect: true });

// Export all resource IDs
export const k3sDnsRecord = k3sCname.id;
export const gpuDnsRecord = gpuCname.id;
export const labelStudioAccessId = labelStudioAccess.id;

// =============================================================================
// PULUMI ESC
// =============================================================================
// ESC environment remains default/oceanid-cluster (shared with bootstrap project)
