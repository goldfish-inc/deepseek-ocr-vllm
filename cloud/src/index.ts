import * as pulumi from "@pulumi/pulumi";
import * as crunchybridge from "@pulumi/crunchybridge";
import * as cloudflare from "@pulumi/cloudflare";
import { PostgresDatabase } from "./components/postgresDatabase";

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
// LABEL STUDIO DATABASE
// =============================================================================
// IMPORTANT: Database provisioning uses command.local.Command and MUST run locally.
// Set enableLabelStudioDb=true ONLY when running locally (not in GitHub Actions).
// Default is false to prevent database creation on every push.

const enableLabelStudioDb = cfg.getBoolean("enableLabelStudioDb") ?? false;
let labelStudioDb: PostgresDatabase | undefined;

if (enableLabelStudioDb) {
    // Admin URL for CrunchyBridge cluster (must have CREATEDB privilege)
    // This is scoped to oceanid-cloud project, separate from cluster runtime URLs
    const adminUrl = cfg.requireSecret("crunchyAdminUrl");
    const labelStudioOwnerPassword = cfg.requireSecret("labelStudioOwnerPassword");

    labelStudioDb = new PostgresDatabase("labelfish", {
        adminUrl,
        databaseName: "labelfish",
        ownerRole: "labelfish_owner",
        ownerPassword: labelStudioOwnerPassword,
        bootstrapSqlPath: "sql/labelstudio/labelfish_schema.sql",
    });
}

export const labelStudioDbUrl: pulumi.Output<string> | undefined = labelStudioDb?.outputs.connectionUrl;
export const labelStudioDbReady: pulumi.Output<boolean> | undefined = labelStudioDb?.outputs.ready;

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

// label studio tunnel (adopted from existing)
const labelCname = new cloudflare.Record("label-cname", {
    zoneId: cloudflareZoneId,
    name: "label.boathou.se",
    type: "CNAME",
    content: "6ff4dfd7-2b77-4a4f-84d9-3241bea658dc.cfargotunnel.com",
    proxied: true,
    ttl: 1,
    comment: "Label Studio for oceanid-cluster via main tunnel",
});

// nautalis documentation site (cloudflare pages)
// Note: DNS is handled automatically by Cloudflare Pages when custom domain is added
// No manual DNS record needed

// =============================================================================
// CLOUDFLARE ACCESS
// =============================================================================

// Access application for nautilus.boathou.se
const nautalisAccessApp = new cloudflare.AccessApplication("nautalis-access-app", {
    zoneId: cloudflareZoneId,
    name: "Nautalis: Goldfish Inc. Documentation",
    domain: "nautilus.boathou.se",
    type: "self_hosted",
    sessionDuration: "24h",
});

// Email OTP authentication policy for nautalis
const nautalisAccessPolicy = new cloudflare.AccessPolicy("nautalis-access-policy", {
    applicationId: nautalisAccessApp.id,
    zoneId: cloudflareZoneId,
    name: "Email verification for nautalis access",
    precedence: 1,
    decision: "allow",
    includes: [
        {
            emails: [
                "ryan@goldfish.io",
                "emily@goldfish.io",
                "celeste@goldfish.io",
            ],
        },
    ],
});

// NOTE: Cloudflare Access disabled for Label Studio per user request
// Label Studio is now publicly accessible via tunnel at label.boathou.se
// Authentication is handled by Label Studio's built-in user management

// Export all resource IDs
export const k3sDnsRecord = k3sCname.id;
export const gpuDnsRecord = gpuCname.id;
export const labelDnsRecord = labelCname.id;
export const nautalisAccessAppId = nautalisAccessApp.id;
export const nautalisAccessPolicyId = nautalisAccessPolicy.id;

// =============================================================================
// PULUMI ESC
// =============================================================================
// ESC environment remains default/oceanid-cluster (shared with bootstrap project)
