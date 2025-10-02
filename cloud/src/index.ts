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
const cloudflareAccountId = cfg.get("cloudflareAccountId");

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

// nautilus documentation site (cloudflare pages)
const nautilusCname = new cloudflare.Record("nautilus-dns", {
    zoneId: cloudflareZoneId,
    name: "nautilus",
    type: "CNAME",
    content: "nautilus.pages.dev",
    proxied: true,
    ttl: 1,
    comment: "Nautilus documentation site (Cloudflare Pages)",
});

// =============================================================================
// CLOUDFLARE ACCESS
// =============================================================================

// Access application for nautilus.boathou.se
const nautilusAccessApp = new cloudflare.AccessApplication("nautilus-access-app", {
    zoneId: cloudflareZoneId,
    name: "Nautilus: Goldfish Inc. Documentation",
    domain: "nautilus.boathou.se",
    type: "self_hosted",
    sessionDuration: "24h",
});

// Email OTP authentication policy for nautilus
const nautilusAccessPolicy = new cloudflare.AccessPolicy("nautilus-access-policy", {
    applicationId: nautilusAccessApp.id,
    zoneId: cloudflareZoneId,
    name: "Email verification for nautilus access",
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

// GPU endpoint protection via service token (used by in-cluster adapter)
const enableGpuAccess = true;
const cfAccessServiceTokenId = cfg.get("cfAccessServiceTokenId");
let gpuAccessApp: cloudflare.AccessApplication | undefined;
if (enableGpuAccess && cfAccessServiceTokenId) {
    gpuAccessApp = new cloudflare.AccessApplication("gpu-access-app", {
        zoneId: cloudflareZoneId,
        name: "GPU Service",
        domain: "gpu.boathou.se",
        sessionDuration: "24h",
        type: "self_hosted",
    });
    new cloudflare.AccessPolicy("gpu-access-allow-service-token", {
        applicationId: gpuAccessApp.id,
        zoneId: cloudflareZoneId,
        name: "Bypass for Adapter Service Token",
        precedence: 1,
        decision: "bypass",
        includes: [
            { serviceTokens: [cfAccessServiceTokenId] } as any,
        ],
    });
}

// Export all resource IDs
export const k3sDnsRecord = k3sCname.id;
export const gpuDnsRecord = gpuCname.id;
export const labelDnsRecord = labelCname.id;
export const nautilusDnsRecord = nautilusCname.id;
export const nautilusAccessAppId = nautilusAccessApp.id;
export const nautilusAccessPolicyId = nautilusAccessPolicy.id;
export const gpuAccessAppId = gpuAccessApp?.id;

// =============================================================================
// PULUMI ESC
// =============================================================================
// ESC environment remains default/oceanid-cluster (shared with bootstrap project)

// =============================================================================
// LABEL STUDIO: "Create Oceanid" header button via Cloudflare Worker (optional)
// =============================================================================

const enableLsHeaderButton = cfg.getBoolean("enableLsHeaderButton") ?? false;
const projectBootstrapperUrl = cfg.get("projectBootstrapperUrl");

if (enableLsHeaderButton) {
    if (!cloudflareAccountId) {
        throw new Error("cloudflareAccountId not set; required for Workers");
    }
    if (!projectBootstrapperUrl) {
        throw new Error("projectBootstrapperUrl not set; required to create Oceanid projects");
    }

    const workerName = "ls-header-injector";
    const workerScriptContent = `
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const res = await fetch(req);
    const ct = res.headers.get('content-type') || '';
    // Only rewrite HTML for Project list and overview pages
    if (!ct.includes('text/html') || !/^\/projects(\/.*)?$/.test(url.pathname)) {
      return res;
    }
    const bootstrapUrl = ${JSON.stringify(projectBootstrapperUrl)};
    class ButtonInjector {
      element(el) {
        el.after(`<button id="create-oceanid" style="margin-left:8px" class="ls-button primary">Create Oceanid<\/button>`, { html: true });
        el.after(`<button id="create-oceanid-tabert" style="margin-left:4px" class="ls-button">TaBERT (exp)<\/button>`, { html: true });
      }
    }
    class ScriptInjector {
      element(el) {
        el.append(`<script>(function(){\n  async function go(tabert){\n    const d=new Date().toISOString().slice(0,10);\n    const title=prompt('Project title','Oceanid NER '+d);\n    if(!title) return;\n    const r=await fetch('${projectBootstrapperUrl}/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title, description: tabert?'TABERT experimental':'', tabert})});\n    try{const data=await r.json(); if(data.project_url){ location.href=data.project_url; } else { alert('Failed: '+JSON.stringify(data)); }}catch(e){ alert('Failed to parse response'); }\n  }\n  addEventListener('click', function(e){\n    const t=e.target;\n    if(t && t.id==='create-oceanid'){ e.preventDefault(); go(false); }\n    if(t && t.id==='create-oceanid-tabert'){ e.preventDefault(); go(true); }\n  }, true);\n})();</script>`, { html: true });
      }
    }
    return new HTMLRewriter()
      .on('a[href="/projects/create"]', new ButtonInjector())
      .on('body', new ScriptInjector())
      .transform(res);
  }
}
`;

    const lsHeaderWorker = new cloudflare.WorkerScript("lsHeaderInjector", {
        name: workerName,
        content: workerScriptContent,
        accountId: cloudflareAccountId,
    });

    // Route all Label Studio HTML through the worker
    new cloudflare.WorkerRoute("lsHeaderRoute", {
        zoneId: cloudflareZoneId,
        pattern: "label.boathou.se/*",
        scriptName: lsHeaderWorker.name,
    }, { dependsOn: [lsHeaderWorker] });
}
