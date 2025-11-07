import * as pulumi from "@pulumi/pulumi";
import * as crunchybridge from "@pulumi/crunchybridge";
import * as cloudflare from "@pulumi/cloudflare";
import { PostgresDatabase } from "./components/postgresDatabase";
import { K3sCluster, NodeConfig } from "./components/k3sCluster";
import { GitHubRunner } from "./components/githubRunner";

// =============================================================================
// OCEANID CLOUD INFRASTRUCTURE
// =============================================================================
// API token updated with Firewall Services:Edit permission (2025-11-07)
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
// CLEANDATA DATABASE (for CSV ingestion, staging, curation pipeline)
// =============================================================================
// Separate database for our data pipeline (stage.*, curated.*, control.*, etc.)
// This keeps Label Studio's internal data separate from our cleaned data

const enableCleandataDb = cfg.getBoolean("enableCleandataDb") ?? false;
let cleandataDb: PostgresDatabase | undefined;

if (enableCleandataDb) {
    // Admin URL for CrunchyBridge cluster (must have CREATEDB privilege)
    const adminUrl = cfg.requireSecret("crunchyAdminUrl");
    const cleandataOwnerPassword = cfg.requireSecret("cleandataOwnerPassword");

    cleandataDb = new PostgresDatabase("cleandata", {
        adminUrl,
        databaseName: "cleandata",
        ownerRole: "cleandata_owner",
        ownerPassword: cleandataOwnerPassword,
        bootstrapSqlPath: "sql/migrations/V1__staging_baseline.sql", // Initial schema
    });
}

export const cleandataDbUrl: pulumi.Output<string> | undefined = cleandataDb?.outputs.connectionUrl;
export const cleandataDbReady: pulumi.Output<boolean> | undefined = cleandataDb?.outputs.ready;

// =============================================================================
// K3S CLUSTER PROVISIONING
// =============================================================================
// Provisions K3s on all nodes via SSH. This must run BEFORE cluster stack.
// Cluster stack only manages resources inside the cluster (Flux, PKO, etc.)

const enableK3sProvisioning = cfg.getBoolean("enableK3sProvisioning") ?? false;
let k3sCluster: K3sCluster | undefined;

if (enableK3sProvisioning) {
    // Node configuration
    // NOTE: Calypso (192.168.2.80) is on a private local network and cannot be
    // reached from GitHub Actions public runners. It will be provisioned manually
    // after the tethys/styx cluster is operational. See docs/operations/manual-calypso-join.md
    const nodes: Record<string, NodeConfig> = {
        "tethys": {
            hostname: "srv712429",
            ip: cfg.require("tethysIp"),
            role: "master",
            labels: {
                "oceanid.node/name": "tethys",
                "oceanid.cluster/control-plane": "primary",
            },
        },
        "styx": {
            hostname: "srv712695",
            ip: cfg.require("styxIp"),
            role: "worker",
            labels: {
                "oceanid.node/name": "styx",
            },
        },
        // "calypso": {  // EXCLUDED: Cannot reach from GitHub Actions (local network)
        //     hostname: "calypso",
        //     ip: cfg.require("calypsoIp"),
        //     role: "worker",
        //     gpu: "nvidia-rtx-4090",
        //     labels: {
        //         "oceanid.node/name": "calypso",
        //         "oceanid.node/gpu": "nvidia-rtx-4090",
        //     },
        // },
    };

    // SSH private keys (stored in ESC under oceanid-cluster namespace)
    const clusterCfg = new pulumi.Config("oceanid-cluster");
    const privateKeys = {
        "tethys": clusterCfg.requireSecret("tethys_ssh_key"),
        "styx": clusterCfg.requireSecret("styx_ssh_key"),
        // "calypso": clusterCfg.requireSecret("calypso_ssh_key"),  // Not needed in cloud stack
    };

    // Load K3s and S3 values directly from ESC environment
    const k3sToken = pulumi.output(process.env.K3S_TOKEN || cfg.requireSecret("k3sToken"));
    const s3AccessKey = pulumi.output(process.env.S3_ACCESS_KEY || cfg.requireSecret("s3AccessKey"));
    const s3SecretKey = pulumi.output(process.env.S3_SECRET_KEY || cfg.requireSecret("s3SecretKey"));

    k3sCluster = new K3sCluster("oceanid", {
        nodes,
        k3sToken,
        k3sVersion: cfg.get("k3sVersion") || "v1.33.4+k3s1",
        privateKeys,
        enableEtcdBackups: true,
        backupS3Bucket: cfg.get("etcdBackupS3Bucket") || "oceanid-cluster-etcd-backups",
        s3Credentials: {
            accessKey: s3AccessKey,
            secretKey: s3SecretKey,
            region: cfg.get("s3Region") || "us-east-1",
            endpoint: cfg.get("s3Endpoint"),
        },
    });
}

export const k3sClusterReady: pulumi.Output<boolean> | undefined = k3sCluster?.outputs.clusterReady;
export const k3sMasterEndpoint: pulumi.Output<string> | undefined = k3sCluster?.outputs.masterEndpoint;

// =============================================================================
// GITHUB ACTIONS RUNNER
// =============================================================================
// Self-hosted runner on tethys for cluster deployments
// Must run AFTER K3s cluster is provisioned

const enableGitHubRunner = cfg.getBoolean("enableGitHubRunner") ?? false;
let githubRunner: GitHubRunner | undefined;

if (enableGitHubRunner) {
    githubRunner = new GitHubRunner("tethys-runner", {
        host: cfg.require("tethysIp"),
        privateKey: cfg.requireSecret("tethysSshKey"),
        githubToken: cfg.requireSecret("githubToken"),
        repository: "goldfish-inc/oceanid",
        runnerName: "tethys",
        labels: ["k8s", "self-hosted-tethys"],
    }, { dependsOn: k3sCluster ? [k3sCluster] : [] });
}

export const githubRunnerReady: pulumi.Output<boolean> | undefined = githubRunner?.runnerReady;

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

// postgraphile graphql api
const graphCname = new cloudflare.Record("graph-cname", {
    zoneId: cloudflareZoneId,
    name: "graph.boathou.se",
    type: "CNAME",
    content: "6ff4dfd7-2b77-4a4f-84d9-3241bea658dc.cfargotunnel.com",
    proxied: true,
    ttl: 1,
    comment: "PostGraphile GraphQL API for vessels data via main tunnel",
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
// CLOUDFLARE TUNNEL CONFIGURATION (Public Hostnames)
// =============================================================================
// Manages the tunnel's ingress rules remotely via Cloudflare API
// This is the source of truth for routing; local configmap ingress is ignored

const mainTunnelId = "6ff4dfd7-2b77-4a4f-84d9-3241bea658dc";

const tunnelConfig = new cloudflare.ZeroTrustTunnelCloudflaredConfig("main-tunnel-config", {
    accountId: cloudflareAccountId!,
    tunnelId: mainTunnelId,
    config: {
        ingressRules: [
            {
                hostname: "k3s.boathou.se",
                service: "https://kubernetes.default.svc.cluster.local:443",
                originRequest: {
                    noTlsVerify: false,
                    caPool: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
                },
            },
            {
                hostname: "label.boathou.se",
                service: "http://argilla.apps.svc.cluster.local:6900",
                originRequest: {
                    noTlsVerify: true,
                },
            },
            {
                hostname: "graph.boathou.se",
                service: "http://postgraphile.apps.svc.cluster.local:8080",
                originRequest: {
                    noTlsVerify: true,
                },
            },
            {
                service: "http_status:404",
            },
        ],
        warpRouting: {
            enabled: true,
        },
    },
});

// =============================================================================
// CLOUDFLARE WAF RULESETS (Modern API)
// =============================================================================
// Protect PostGraphile /graphql endpoint from abuse
// - Block GET requests entirely (GraphQL doesn't support GET introspection via deprecated Filter)
// - Rate limit POST requests to prevent abuse (using free tier constraints)

// NOTE: GET blocking handled by existing cloudflare:index:Filter + cloudflare:index:FirewallRule
// (graphql-get-filter + graphql-get-block from previous deployment)
// Cannot create new http_request_firewall_custom ruleset due to existing rules

// Rate limiting rule for all requests to /graphql
// Free tier constraints: period must be 10s (not 60s)
// Reduced to 5 req/10s (30 req/min) to prevent data exfiltration
const graphqlRateLimitRuleset = new cloudflare.Ruleset("graphql-ratelimit-ruleset", {
    zoneId: cloudflareZoneId,
    name: "PostGraphile Rate Limit",
    description: "Rate limit for /graphql endpoint (5 req/10s = 30 req/min)",
    kind: "zone",
    phase: "http_ratelimit",
    rules: [
        {
            action: "block",
            expression: '(http.host eq "graph.boathou.se" and http.request.uri.path eq "/graphql")',
            description: "Rate limit /graphql: 5 req/10s per IP+colo",
            enabled: true,
            ratelimit: {
                characteristics: ["cf.colo.id", "ip.src"],
                period: 10, // Free tier only allows 10s
                requestsPerPeriod: 5, // 5/10s = 30/60s (reduced from 120/min for security)
                mitigationTimeout: 10, // Free tier only allows 10s
            },
        },
    ],
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

// PostGraphile API protection with service-token-only authentication
// CORS is handled by PostGraphile itself (apps/postgraphile/server.js)
// No GraphiQL playground (disabled in PostGraphile config) → no need for browser auth

// Create service token for PostGraphile API access
const postgraphileServiceToken = new cloudflare.AccessServiceToken("postgraphile-service-token", {
    accountId: cloudflareAccountId,
    name: "PostGraphile Platform Components",
    duration: "8760h", // 1 year
});

const postgraphileAccessApp = new cloudflare.AccessApplication("postgraphile-access-app", {
    zoneId: cloudflareZoneId,
    name: "PostGraphile GraphQL API",
    domain: "graph.boathou.se",
    type: "self_hosted",
    sessionDuration: "24h",
});

// Service token bypass for platform components only
new cloudflare.AccessPolicy("postgraphile-access-service-token", {
    applicationId: postgraphileAccessApp.id,
    zoneId: cloudflareZoneId,
    name: "Platform Components (Service Token)",
    precedence: 10,
    decision: "bypass",
    includes: [
        { serviceTokens: [postgraphileServiceToken.id] } as any,
    ],
});

// Export all resource IDs
export const k3sDnsRecord = k3sCname.id;
export const gpuDnsRecord = gpuCname.id;
export const labelDnsRecord = labelCname.id;
export const graphDnsRecord = graphCname.id;
export const nautilusDnsRecord = nautilusCname.id;
export const nautilusAccessAppId = nautilusAccessApp.id;
export const nautilusAccessPolicyId = nautilusAccessPolicy.id;
export const gpuAccessAppId = gpuAccessApp?.id;
export const postgraphileAccessAppId = postgraphileAccessApp.id;
export const postgraphileServiceTokenClientId = postgraphileServiceToken.clientId;
export const postgraphileServiceTokenClientSecret = postgraphileServiceToken.clientSecret;
export const graphqlRateLimitRulesetId = graphqlRateLimitRuleset.id;

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
        el.after(\`<button id="create-oceanid" style="margin-left:8px" class="ls-button primary">Create Oceanid</button>\`, { html: true });
        el.after(\`<button id="create-oceanid-tabert" style="margin-left:4px" class="ls-button">TaBERT (exp)</button>\`, { html: true });
      }
    }
    class ScriptInjector {
      element(el) {
        el.append(\`<script>(function(){\\n  async function go(tabert){\\n    const d=new Date().toISOString().slice(0,10);\\n    const title=prompt('Project title','Oceanid NER '+d);\\n    if(!title) return;\\n    const r=await fetch('${projectBootstrapperUrl}/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title, description: tabert?'TABERT experimental':'', tabert})});\\n    try{const data=await r.json(); if(data.project_url){ location.href=data.project_url; } else { alert('Failed: '+JSON.stringify(data)); }}catch(e){ alert('Failed to parse response'); }\\n  }\\n  addEventListener('click', function(e){\\n    const t=e.target;\\n    if(t && t.id==='create-oceanid'){ e.preventDefault(); go(false); }\\n    if(t && t.id==='create-oceanid-tabert'){ e.preventDefault(); go(true); }\\n  }, true);\\n})();</script>\`, { html: true });
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
