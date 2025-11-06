import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as command from "@pulumi/command";

import { clusterConfig } from "./config";
import { cloudflareProvider, k8sProvider, kubeconfigPath } from "./providers";
import { CloudflareTunnel } from "./components/cloudflareTunnel";
import { PulumiOperator } from "./components/pulumiOperator";
import { configureGitOps } from "./gitops";
// import { LabelStudio } from "./components/labelStudio"; // MOVED TO GITOPS
import { HostCloudflared } from "./components/hostCloudflared";
import { HostTailscale } from "./components/hostTailscale";
import { HostDockerService } from "./components/hostDockerService";
import { HostModelPuller } from "./components/hostModelPuller";
import { getSentrySettings, toEnvVars } from "./sentry-config";
import { ControlPlaneLoadBalancer } from "./components/controlPlaneLoadBalancer";
import { MigrationOrchestrator } from "./components/migrationOrchestrator";
import { NodeTunnels } from "./components/nodeTunnels";
import { SMEReadiness } from "./components/smeReadiness";
import { DbBootstrap } from "./components/dbBootstrap";
import { TailscaleOperator } from "./components/tailscaleOperator";
import { TailscaleSubnetRouter } from "./components/tailscaleSubnetRouter";
import { PrometheusOperator } from "./components/prometheusOperator";

// =============================================================================
// CLUSTER RESOURCES
// =============================================================================
// NOTE: K3s cluster provisioning moved to oceanid-cloud stack
// NOTE: CI guard is in providers.ts to catch GitHub Actions before kubeconfig loading
// This stack assumes K3s is already provisioned and only manages in-cluster resources

const cfg = new pulumi.Config();
const namespaceName = "apps";

// Ensure the 'apps' namespace exists before any resources target it.
// Pulumi owns foundational namespaces; Flux owns workloads inside them.
const appsNamespace = new k8s.core.v1.Namespace("apps-namespace", {
    metadata: {
        name: namespaceName,
        labels: {
            "app.kubernetes.io/part-of": "apps",
            "pod-security.kubernetes.io/enforce": "baseline",
        },
    },
}, { provider: k8sProvider });

// SSH keys for host-level components (Calypso connectors, Tailscale)
const privateKeys = {
    tethys: cfg.requireSecret("tethys_ssh_key"),
    styx: cfg.requireSecret("styx_ssh_key"),
    calypso: cfg.requireSecret("calypso_ssh_key"),
};

// Feature flags
const enableMigration = cfg.getBoolean("enableMigration") ?? true;

// Create load balancer for multi-control-plane high availability
// NOTE: Assumes K3s cluster is already provisioned by cloud stack
const enableControlPlaneLB = cfg.getBoolean("enableControlPlaneLB") ?? true;
const controlPlaneLB = enableControlPlaneLB
    ? new ControlPlaneLoadBalancer("control-plane-lb", {
        masterNodes: [
            { name: "tethys", ip: cfg.require("tethysIp"), hostname: "srv712429" },
            { name: "styx", ip: cfg.require("styxIp"), hostname: "srv712695" },
        ],
        k8sProvider,
        enableHealthChecks: true,
    })
    : undefined;

// =============================================================================
// INFRASTRUCTURE COMPONENTS
// =============================================================================

const gpuHostname = pulumi.interpolate`gpu.${clusterConfig.nodeTunnel.hostname}`;
const airflowHostname = pulumi.interpolate`airflow.${clusterConfig.nodeTunnel.hostname}`;
const minioHostname = pulumi.interpolate`minio.${clusterConfig.nodeTunnel.hostname}`;
const graphqlHostname = "graph.boathou.se"; // PostGraphile GraphQL API
const enableAppsStack = cfg.getBoolean("enableAppsStack") ?? false;

const extraIngressRules: Array<{ hostname: pulumi.Input<string>; service: pulumi.Input<string>; noTLSVerify?: pulumi.Input<boolean> }>= [
    // Note: GPU service is handled by HostCloudflared on Calypso, not this tunnel
    // PostGraphile GraphQL API for vessels data
    { hostname: graphqlHostname, service: "http://postgraphile.apps.svc.cluster.local:8080", noTLSVerify: true },
];

if (enableAppsStack) {
    extraIngressRules.push(
        { hostname: airflowHostname, service: pulumi.output("http://airflow-web.apps.svc.cluster.local:8080"), noTLSVerify: true },
        { hostname: minioHostname, service: pulumi.output("http://minio-console.apps.svc.cluster.local:9001"), noTLSVerify: true },
    );
}

// =============================================================================
// Cloudflare Access for app UIs (optional, recommended)
// =============================================================================

const accessAllowedEmailDomain = cfg.get("accessAllowedEmailDomain");
const accessAllowedEmails = cfg.getObject<string[]>("accessAllowedEmails");

function accessForHost(host: pulumi.Input<string>, appName: string) {
    const includes: pulumi.Input<any>[] = [];
    if (accessAllowedEmailDomain) {
        includes.push({ emailDomain: { domain: accessAllowedEmailDomain } });
    }
    if (accessAllowedEmails && accessAllowedEmails.length > 0) {
        for (const e of accessAllowedEmails) {
            includes.push({ email: { email: e } });
        }
    }

    new cloudflare.ZeroTrustAccessApplication(`${appName}-access-app`, {
        zoneId: clusterConfig.cloudflare.zoneId,
        name: pulumi.interpolate`${appName}@${host}` as unknown as string,
        domain: host as unknown as string,
        sessionDuration: "24h",
        policies: [
            {
                name: pulumi.interpolate`${appName}-allow` as unknown as string,
                precedence: 1,
                decision: "allow",
                includes: includes as any,
            },
        ],
    }, { provider: cloudflareProvider, deleteBeforeReplace: true });
}

// Apply Access to optional app UIs when enabled
if (enableAppsStack && (accessAllowedEmailDomain || (accessAllowedEmails && accessAllowedEmails.length > 0))) {
    accessForHost(airflowHostname, "airflow");
    accessForHost(minioHostname, "minio");
}

const tunnel = new CloudflareTunnel("cloudflare", {
    cluster: clusterConfig,
    k8sProvider,
    cloudflareProvider,
    extraIngress: extraIngressRules,
});

// Optional: Core apps on k8s with private Services; UIs exposed via Cloudflare tunnel
if (enableAppsStack) {
    const pgPassword = cfg.getSecret("postgres_password");
    if (pgPassword) {
        const pg = new k8s.helm.v3.Release("postgres", {
            chart: "postgresql",
            version: "15.5.0",
            repositoryOpts: { repo: "https://charts.bitnami.com/bitnami" },
            name: "postgres",
            namespace: namespaceName,
            values: {
                auth: { postgresPassword: pgPassword },
                primary: { persistence: { enabled: true, size: "50Gi" } },
                service: { type: "ClusterIP" },
            },
        }, { provider: k8sProvider, parent: appsNamespace });

        // Bootstrap schemas/tables for control/raw/stage/label/curated
        const dbUrl = pulumi.interpolate`postgresql://postgres:${pgPassword}@postgres.${namespaceName}.svc.cluster.local:5432/postgres`;
        new DbBootstrap("db-bootstrap", { k8sProvider, namespace: namespaceName, dbUrl }, { parent: appsNamespace, dependsOn: [pg] });
    }
    // MinIO/Airflow intentionally skipped per ops decision; add flags later if needed.
}

// =============================================================================
// CRUNCHYBRIDGE DATABASE PROVISIONING
// =============================================================================

// NOTE: CrunchyBridge PostgreSQL cluster now managed by oceanid-cloud stack

const enableFluxBootstrap = cfg.getBoolean("enableFluxBootstrap") ?? false;
const enableImageAutomation = cfg.getBoolean("enableImageAutomation") ?? false;

const { flux, imageAutomation } = configureGitOps({
    enableBootstrap: enableFluxBootstrap,
    enableImageAutomation,
    cluster: clusterConfig,
    k8sProvider,
});

const pko = new PulumiOperator("pko", {
    cluster: clusterConfig,
    k8sProvider,
});

// Deploy node tunnels for bidirectional pod networking (especially for Calypso GPU node)
const enableNodeTunnels = cfg.getBoolean("enableNodeTunnels") ?? true;
let nodeTunnels: NodeTunnels | undefined;
if (enableNodeTunnels) {
    nodeTunnels = new NodeTunnels("node-tunnels", {
        cluster: clusterConfig,
        k8sProvider,
        // NOTE: Cloudflare DNS & Access are managed by the cloud stack
    });
}

// Monitoring (Prometheus Operator with ServiceMonitor for sink)
(() => {
    const cfgProm = new pulumi.Config();
    const rwUrl = cfgProm.get("grafanaRemoteWriteUrl");
    const rwUser = cfgProm.getSecret("grafanaRemoteWriteUsername");
    const rwPass = cfgProm.getSecret("grafanaRemoteWritePassword");
    const remoteWrite = rwUrl ? { url: rwUrl as any, username: rwUser as any, password: rwPass as any } : undefined;
    new PrometheusOperator("prom-operator", {
        k8sProvider,
        namespace: "monitoring",
        remoteWrite,
        scrapeInterval: "60s",
    });
})();

const cleandataDbUrl = cfg.requireSecret("cleandataDbUrl");

// GHCR image pull secret (private images)
(() => {
    const cfg = new pulumi.Config();
    const ghcrUser = cfg.get("ghcrUsername");
    const ghcrToken = cfg.getSecret("ghcrToken");
    if (ghcrUser && ghcrToken) {
        const auth = pulumi.interpolate`${ghcrUser}:${ghcrToken}`.apply(s => Buffer.from(s).toString("base64"));
        const dockerconfig = pulumi.all([auth]).apply(([a]) => JSON.stringify({ auths: { "ghcr.io": { auth: a, username: ghcrUser } } }));
        new k8s.core.v1.Secret("ghcr-creds", {
            metadata: { name: "ghcr-creds", namespace: "apps" },
            type: "kubernetes.io/dockerconfigjson",
            data: { ".dockerconfigjson": dockerconfig.apply(v => Buffer.from(v).toString("base64")) },
        }, { provider: k8sProvider, parent: appsNamespace });
    }
})();

// PostGraphile secrets (Crunchy Bridge connection)
// ESC config: postgraphileDatabaseUrl using hostname for strict TLS verification
(() => {
    const cfg = new pulumi.Config();
    const databaseUrl = cfg.getSecret("postgraphileDatabaseUrl");
    const corsOrigins = cfg.get("postgraphileCorsOrigins") || "https://ocean-goldfish.vercel.app,https://ocean.boathou.se";
    if (databaseUrl) {
        new k8s.core.v1.Secret("postgraphile-secrets", {
            metadata: { name: "postgraphile-secrets", namespace: "apps" },
            type: "Opaque",
            stringData: {
                DATABASE_URL: databaseUrl,
                CORS_ORIGINS: corsOrigins,
            },
        }, { provider: k8sProvider, parent: appsNamespace });
    }
})();


// Verification: DB ingest check (stage.table_ingest)
// Temporarily disabled to avoid blocking deploys. Re-enable behind config in future.
/*
(() => {
    const cfg = new pulumi.Config();
    const pgUrl = cfg.getSecret("postgres_url");
    const enableDbVerify = cfg.getBoolean("enableDbVerify") ?? false;
    const verifyCmd = enableDbVerify
        ? "echo 'now:' && psql \"$DATABASE_URL\" -t -c 'select now();' && echo 'table_ingest:' && psql \"$DATABASE_URL\" -t -c 'select count(*) from stage.table_ingest;'"
        : "echo 'db-verify disabled via config'; exit 0";
    new k8s.batch.v1.Job("db-verify-ingest", {
        metadata: { name: "db-verify-ingest", namespace: "apps", annotations: { "pulumi.com/skipAwait": "true" } },
        spec: {
            backoffLimit: 0,
            template: {
                metadata: { labels: { app: "db-verify" } },
                spec: {
                    restartPolicy: "Never",
                    containers: [{
                        name: "psql",
                        image: "postgres:16-alpine",
                        command: ["sh", "-c", verifyCmd],
                        env: pgUrl ? ([{ name: "DATABASE_URL", value: pgUrl as any }] as any) : ([] as any),
                    }],
                },
            },
        },
    }, { provider: k8sProvider });
})();
*/

// SME Readiness - Configure boathou.se domain with Cloudflare Access
// NOTE: Access app creation is now managed by cloud stack to prevent duplication
// This component only exports URLs and service token management
const enableSMEAccess = cfg.getBoolean("enableSMEAccess") ?? false; // Default false - cloud stack owns Access
const smeEmailDomain = cfg.get("accessAllowedEmailDomain") ?? "boathou.se";

const smeReadiness = new SMEReadiness("sme-ready", {
    cloudflareProvider,
    zoneId: clusterConfig.cloudflare.zoneId,
    tunnelId: clusterConfig.cloudflare.tunnelId,
    nodeTunnelId: clusterConfig.nodeTunnel.tunnelId,
    emailDomain: smeEmailDomain,
    enableLabelStudioAccess: enableSMEAccess,
});

// HF token for model pulling
const hfToken = cfg.getSecret("hfAccessToken");

// =============================================================================
// EGRESS DB PROXY (TCP forwarder for Postgres via unified egress on tethys)
// =============================================================================
// Provide a stable in-cluster hostname for Postgres connections that egress from
// tethys, ensuring CrunchyBridge sees a single public IP.

(() => {
    const egressDbProxyEnabled = true; // always-on for prod stack
    if (!egressDbProxyEnabled) return;

    // Extract upstream host/port from cleandataDbUrl (falls back to 5432)
    const upstreamHost = (cleandataDbUrl as any).apply((url: string) => {
        try { const u = new URL(url); return u.hostname; } catch { return ""; }
    });
    const upstreamPort = (cleandataDbUrl as any).apply((url: string) => {
        try { const u = new URL(url); return u.port && u.port.length > 0 ? u.port : "5432"; } catch { return "5432"; }
    });

    const labels = { app: "egress-db-proxy" } as any;

    const dep = new k8s.apps.v1.Deployment("egress-db-proxy", {
        metadata: { name: "egress-db-proxy", namespace: namespaceName, labels },
        spec: {
            replicas: 1,
            selector: { matchLabels: labels },
            template: {
                metadata: { labels },
                spec: {
                    // Pin to tethys so outbound IP is unified
                    nodeSelector: { "oceanid.node/name": "tethys" },
                    containers: [{
                        name: "db-proxy",
                        image: "alpine:3.19",
                        ports: [{ containerPort: 5432, name: "pg" }],
                        command: ["/bin/sh","-c"],
                        args: [
                            pulumi.interpolate`set -euo pipefail
apk add --no-cache socat >/dev/null
echo "Forwarding :5432 -> ${upstreamHost}:${upstreamPort}"
exec socat -d -d TCP-LISTEN:5432,fork,reuseaddr TCP:${upstreamHost}:${upstreamPort}` as any,
                        ],
                        resources: { requests: { cpu: "10m", memory: "16Mi" }, limits: { cpu: "100m", memory: "64Mi" } },
                    }],
                },
            },
        },
    }, { provider: k8sProvider, parent: appsNamespace });

    new k8s.core.v1.Service("egress-db-proxy", {
        metadata: { name: "egress-db-proxy", namespace: namespaceName },
        spec: {
            selector: labels,
            ports: [{ name: "pg", port: 5432, targetPort: "pg" as any }],
            type: "ClusterIP",
        },
    }, { provider: k8sProvider, parent: appsNamespace, dependsOn: [dep] });
})();

// =============================================================================
// TAILSCALE EXIT NODE (Unified Egress IP)
// =============================================================================

// Deploy Tailscale Operator for Kubernetes-native connectivity management
const enableTailscale = cfg.getBoolean("enableTailscale") ?? false;
const enableHostTailscale = cfg.getBoolean("enableHostTailscale") ?? false;
let tailscaleOperator: TailscaleOperator | undefined;
let subnetRouter: TailscaleSubnetRouter | undefined;
let tailscaleExitNode: HostTailscale | undefined;
const tailscaleClients: HostTailscale[] = [];

if (enableTailscale) {
    const tailscaleOperatorOAuthClientId = cfg.getSecret("tailscaleOperatorOAuthClientId");
    const tailscaleOperatorOAuthSecret = cfg.getSecret("tailscaleOperatorOAuthSecret");
    const tailscaleAuthKey = cfg.getSecret("tailscaleAuthKey");
    const tailscaleAdvertisedRoutes = cfg.getObject<string[]>("tailscaleAdvertisedRoutes") ?? ["10.42.0.0/16", "10.43.0.0/16"];
    const tailscaleAdvertiseTags = cfg.getObject<string[]>("tailscaleAdvertiseTags") ?? ["tag:k3s-node"];
    const tailscaleExitNodeHostname = cfg.get("tailscaleExitNodeHostname") ?? "srv712429-oceanid";
    const tailscaleClientNames = cfg.getObject<Record<string, string>>("tailscaleClientHosts") ?? {
        styx: "srv712695-oceanid",
        calypso: "calypso-oceanid",
    };

    if (tailscaleOperatorOAuthClientId && tailscaleOperatorOAuthSecret && tailscaleAuthKey) {
        // Deploy Tailscale Operator (manages authentication and device registration)
        tailscaleOperator = new TailscaleOperator("tailscale-operator", {
            namespace: "tailscale",
            oauthClientId: tailscaleOperatorOAuthClientId as any,
            oauthClientSecret: tailscaleOperatorOAuthSecret as any,
            k8sProvider,
        });

        // Deploy Subnet Router (advertises K8s CIDRs and acts as exit node)
        // Pinned to tethys node for stable egress IP (157.173.210.123)
        subnetRouter = new TailscaleSubnetRouter("tailscale-subnet-router", {
            namespace: "tailscale",
            authKey: tailscaleAuthKey as any,
            routes: ["10.42.0.0/16", "10.43.0.0/16"], // K8s pod + service CIDRs
            advertiseExitNode: true,
            acceptDNS: true,
            nodeSelectorKey: "oceanid.node/name",
            nodeSelectorValue: "tethys", // Pin to tethys (srv712429) for 157.173.210.123 IP
            k8sProvider,
        }, { dependsOn: [tailscaleOperator] });

        if (enableHostTailscale) {
            // srv712429 acts as unified egress exit node
            tailscaleExitNode = new HostTailscale("tailscale-exit-node", {
                host: cfg.require("tethysIp"),
                user: "root",
                privateKey: privateKeys.tethys,
                authKey: tailscaleAuthKey as any,
                hostname: tailscaleExitNodeHostname,
                advertiseRoutes: tailscaleAdvertisedRoutes,
                advertiseExitNode: true,
                acceptRoutes: true,
                acceptDNS: true,
                advertiseTags: tailscaleAdvertiseTags,
            }, { dependsOn: [subnetRouter] });

            const exitNodeIdentifier = cfg.get("tailscaleExitNodeName") ?? tailscaleExitNodeHostname;
            const tailscaleClientSpecs: Array<{ key: keyof typeof privateKeys; ipConfig: string; hostname: string }> = [
                { key: "styx", ipConfig: cfg.require("styxIp"), hostname: tailscaleClientNames.styx || "srv712695-oceanid" },
                { key: "calypso", ipConfig: "192.168.2.80", hostname: tailscaleClientNames.calypso || "calypso-oceanid" },
            ];

            for (const clientConfig of tailscaleClientSpecs) {
                tailscaleClients.push(new HostTailscale(`tailscale-${clientConfig.key}`, {
                    host: clientConfig.ipConfig,
                    user: "root",
                    privateKey: privateKeys[clientConfig.key],
                    authKey: tailscaleAuthKey as any,
                    hostname: clientConfig.hostname,
                    acceptRoutes: true,
                    acceptDNS: true,
                    exitNode: exitNodeIdentifier,
                    exitNodeAllowLanAccess: true,
                    advertiseTags: tailscaleAdvertiseTags,
                }, { dependsOn: [tailscaleExitNode!] }));
            }
        }
    }
}

// Optional: host-level Cloudflared connector on Calypso for GPU access
const enableCalypsoHostConnector = cfg.getBoolean("enableCalypsoHostConnector") ?? true;
let calypsoConnector: HostCloudflared | undefined;
let calypsoTriton: HostDockerService | undefined;
if (enableCalypsoHostConnector) {
    calypsoConnector = new HostCloudflared("calypso-connector", {
        host: "192.168.2.80",
        user: "oceanid",
        privateKey: cfg.requireSecret("calypso_ssh_key"),
        tunnelId: clusterConfig.nodeTunnel.tunnelId,
        tunnelToken: clusterConfig.nodeTunnel.tunnelToken,
        hostnameBase: clusterConfig.nodeTunnel.hostname,
        gpuPort: 8000,  // Triton HTTP port
    });

    // Start Triton Inference Server on Calypso via generic HostDockerService
    const sentry = getSentrySettings();
    const tritonEnv = toEnvVars(sentry);
    const tritonImage = cfg.get("tritonImage") || "nvcr.io/nvidia/tritonserver:25.08-py3";
    calypsoTriton = new HostDockerService("calypso-triton", {
        host: "192.168.2.80",
        user: "oceanid",
        privateKey: cfg.requireSecret("calypso_ssh_key"),
        serviceName: "tritonserver",
        image: tritonImage,
        name: "tritonserver",
        ports: [
            { host: 8000, container: 8000 },
            { host: 8001, container: 8001 },
            { host: 8002, container: 8002 },
        ],
        volumes: [
            { hostPath: "/opt/triton/models", containerPath: "/models" },
        ],
        env: tritonEnv,
        gpus: true,
        args: [
            "tritonserver",
            "--model-repository=/models",
            "--strict-model-config=false",
            "--model-control-mode=poll",
            "--repository-poll-secs=60",
        ],
    }, { dependsOn: [calypsoConnector] });

    // NOTE: GPU DNS record (gpu.boathou.se) now managed by oceanid-cloud stack

    // Host-side model pullers to fetch latest models from HF and drop new versions for Triton
    const hfModelRepo = cfg.get("hfModelRepo") || "distilbert/distilbert-base-uncased";
    const graniteModelRepo = cfg.get("graniteModelRepo") || "ibm-granite/granite-docling-258M";

    if (hfToken) {
        // DistilBERT NER model (PyTorch - will be converted to ONNX later)
        new HostModelPuller("calypso-distilbert-puller", {
            host: "192.168.2.80",
            user: "oceanid",
            privateKey: cfg.requireSecret("calypso_ssh_key"),
            hfToken: hfToken,
            hfModelRepo: hfModelRepo,
            targetDir: "/opt/triton/models/distilbert-base-uncased",
            interval: "15min",
            modelType: "pytorch",
        }, { dependsOn: [calypsoTriton!] });

        // Granite Docling model (PyTorch/MLX)
        new HostModelPuller("calypso-granite-puller", {
            host: "192.168.2.80",
            user: "oceanid",
            privateKey: cfg.requireSecret("calypso_ssh_key"),
            hfToken: hfToken,
            hfModelRepo: graniteModelRepo,
            targetDir: "/opt/triton/models/docling_granite_python",
            interval: "15min",
            modelType: "pytorch",
        }, { dependsOn: [calypsoTriton!] });
    }

    // Sync Triton model configs from repo to Calypso and restart Triton
    try {
        const fs = require("fs");
        const path = require("path");
        const distilCfg = fs.readFileSync(path.resolve(process.cwd(), "..", "triton-models/distilbert-base-uncased/config.pbtxt"), "utf8");
        const doclingCfg = fs.readFileSync(path.resolve(process.cwd(), "..", "triton-models/docling_granite_python/config.pbtxt"), "utf8");
        new command.remote.Command("calypso-sync-triton-configs", {
            connection: { host: "192.168.2.80", user: "oceanid", privateKey: cfg.requireSecret("calypso_ssh_key") },
            create: `
set -euo pipefail
SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi
$SUDO mkdir -p /opt/triton/models/distilbert-base-uncased /opt/triton/models/docling_granite_python
cat > /tmp/distilbert_config.pbtxt <<'CFG'
${distilCfg}
CFG
cat > /tmp/docling_config.pbtxt <<'CFG'
${doclingCfg}
CFG
$SUDO mv /tmp/distilbert_config.pbtxt /opt/triton/models/distilbert-base-uncased/config.pbtxt
$SUDO mv /tmp/docling_config.pbtxt /opt/triton/models/docling_granite_python/config.pbtxt
$SUDO systemctl restart tritonserver
            `,
        }, { dependsOn: [calypsoTriton!] });
    } catch (e) {
        // Ignore local read errors during preview
    }
}

// =============================================================================
// EXPORTS FOR SME READINESS
// =============================================================================

export const smeUrls = {
    gpuServices: smeReadiness.gpuServiceUrl,
};

export const smeAccess = {
    emailDomain: smeEmailDomain,
    accessEnabled: enableSMEAccess,
    accessPolicyId: smeReadiness.accessPolicyId,
};

// =============================================================================
// SCRIPT RETIREMENT MIGRATION
// =============================================================================

// Create migration orchestrator to manage script retirement
const migration = enableMigration
    ? new MigrationOrchestrator("script-retirement", {
        k8sProvider,
        escEnvironment: "default/oceanid-cluster",
        migrationPhase: cfg.get("migration_phase") as any || "preparation",
        enableSSHRotation: true,
        enableK3sRotation: true,
        enableSecurityHardening: true,
        enableCredentialSync: true,
        nodes: {
            tethys: {
                ip: cfg.require("tethysIp"),
                hostname: "srv712429",
                user: "root",
                privateKey: cfg.requireSecret("tethys_ssh_key"),
                onePasswordItemId: "c5s7qr6dvpzqpluqok2a7gfmzu",
            },
            styx: {
                ip: cfg.require("styxIp"),
                hostname: "srv712695",
                user: "root",
                privateKey: cfg.requireSecret("styx_ssh_key"),
                onePasswordItemId: "6c75oaaly7mgfdme35gwwpakhq",
            },
            calypso: {
                ip: "192.168.2.80",
                hostname: "calypso",
                user: "oceanid",
                privateKey: cfg.requireSecret("calypso_ssh_key"),
            },
        },
    }, { dependsOn: ((() => { const deps: pulumi.Resource[] = [pko]; if (imageAutomation) deps.push(imageAutomation); if (flux) deps.push(flux); if (controlPlaneLB) deps.unshift(controlPlaneLB); return deps; })()) })
    : undefined;

export const outputs = {
    // Cluster provisioning (managed by oceanid-cloud stack)
    clusterProvisioningNote: pulumi.output("K3s cluster provisioning is managed by the oceanid-cloud stack"),

    // High availability
    controlPlaneLB: controlPlaneLB ? controlPlaneLB.outputs.loadBalancerIP : pulumi.output(""),
    controlPlaneHealthStatus: controlPlaneLB ? controlPlaneLB.outputs.healthStatus : pulumi.output({}),

    // Infrastructure
    kubeconfigPath,
    cloudflareNamespace: tunnel.outputs.namespace,
    cloudflareDeployment: tunnel.outputs.deploymentName,
    cloudflareMetricsService: tunnel.outputs.metricsServiceName,
    cloudflareDnsRecord: tunnel.outputs.dnsRecordName,
    calypsoTritonReady: calypsoTriton ? calypsoTriton.serviceReady : pulumi.output(false),
    nodeTunnelNamespace: nodeTunnels ? nodeTunnels.outputs.namespace : pulumi.output(""),
    nodeTunnelDaemonSet: nodeTunnels ? nodeTunnels.outputs.daemonSetName : pulumi.output(""),
    nodeTunnelMetricsService: nodeTunnels ? nodeTunnels.outputs.metricsServiceName : pulumi.output(""),
    nodeTunnelDnsRecords: nodeTunnels ? nodeTunnels.outputs.dnsRecords : pulumi.output({}),
    fluxNamespace: flux ? flux.namespace : pulumi.output(""),
    gitRepository: clusterConfig.gitops.repositoryUrl,
    gitPath: clusterConfig.gitops.path,
    pkoNamespace: pko.namespace,
    pkoSecretName: pko.secretName,

    // Migration status
    migrationStatus: migration ? migration.outputs.migrationStatus : pulumi.output({
        phase: cfg.get("migration_phase") || "preparation",
        completedComponents: [],
        activeComponents: [],
        nextSteps: ["Enable migration components"],
    }),
    componentHealth: migration ? migration.outputs.componentHealth : pulumi.output({}),
    scriptRetirementReady: migration ? migration.outputs.scriptRetirementReady : pulumi.output(false),
};
// Trigger deployment: PostGraphile ESC configuration applied $(date +%Y-%m-%d)
