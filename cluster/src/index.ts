import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as command from "@pulumi/command";

import { clusterConfig } from "./config";
import { cloudflareProvider, k8sProvider, kubeconfigPath } from "./providers";
import { CloudflareTunnel } from "./components/cloudflareTunnel";
import { FluxBootstrap } from "./components/fluxBootstrap";
import { PulumiOperator } from "./components/pulumiOperator";
import { ImageAutomation } from "./components/imageAutomation";
import { LabelStudio } from "./components/labelStudio";
import { HostCloudflared } from "./components/hostCloudflared";
import { HostDockerService } from "./components/hostDockerService";
import { HostModelPuller } from "./components/hostModelPuller";
import { LsTritonAdapter } from "./components/lsTritonAdapter";
import { getSentrySettings, toEnvVars } from "./sentry-config";
import { K3sCluster, NodeConfig } from "./components/k3sCluster";
import { ControlPlaneLoadBalancer } from "./components/controlPlaneLoadBalancer";
import { MigrationOrchestrator } from "./components/migrationOrchestrator";
import { NodeTunnels } from "./components/nodeTunnels";
import { SMEReadiness } from "./components/smeReadiness";
import { AnnotationsSink } from "./components/annotationsSink";
import { DbBootstrap } from "./components/dbBootstrap";
import { DatabaseMigrations } from "./components/databaseMigrations";
import { CrunchyBridgeCluster } from "./components/crunchyBridgeCluster";

// =============================================================================
// CLUSTER PROVISIONING
// =============================================================================

const cfg = new pulumi.Config();
const namespaceName = "apps";

// Node configuration - Multi-control-plane for high availability
const nodes: Record<string, NodeConfig> = {
    tethys: {
        hostname: "srv712429",
        ip: cfg.require("tethysIp"),
        role: "master",
        labels: {
            "node-role.kubernetes.io/control-plane": "true",
            "oceanid.cluster/node": "tethys",
            "oceanid.cluster/provider": "hostinger",
            "oceanid.cluster/control-plane": "primary"
        }
    },
    styx: {
        hostname: "srv712695",
        ip: cfg.require("styxIp"),
        role: "master", // Convert to second control plane node
        labels: {
            "node-role.kubernetes.io/control-plane": "true",
            "oceanid.cluster/node": "styx",
            "oceanid.cluster/provider": "hostinger",
            "oceanid.cluster/control-plane": "secondary"
        }
    },
    calypso: {
        hostname: "calypso",
        ip: "192.168.2.80",
        role: "worker",
        gpu: "rtx4090",
        labels: {
            "node-role.kubernetes.io/worker": "true",
            "node.kubernetes.io/instance-type": "gpu",
            "oceanid.cluster/tunnel-enabled": "true",
            "oceanid.cluster/node": "calypso",
            "oceanid.cluster/gpu": "rtx4090",
            "oceanid.cluster/provider": "local"
        }
    }
};

// SSH keys for node access
const privateKeys = {
    tethys: cfg.requireSecret("tethys_ssh_key"),
    styx: cfg.requireSecret("styx_ssh_key"),
    calypso: cfg.requireSecret("calypso_ssh_key"),
};

// Feature flags to avoid long SSH operations during troubleshooting
const enableNodeProvisioning = cfg.getBoolean("enableNodeProvisioning") ?? true;
const enableMigration = cfg.getBoolean("enableMigration") ?? true;

// Create the K3s cluster with idempotent node provisioning (optional)
let cluster: K3sCluster | undefined;
if (enableNodeProvisioning) {
    cluster = new K3sCluster("oceanid", {
        nodes,
        k3sToken: cfg.requireSecret("k3s_token"),
        k3sVersion: cfg.get("k3s_version") || "v1.33.4+k3s1",
        privateKeys,
        enableEtcdBackups: true,
        backupS3Bucket: cfg.get("etcd_backup_s3_bucket"),
        s3Credentials: {
            accessKey: cfg.requireSecret("s3_access_key"),
            secretKey: cfg.requireSecret("s3_secret_key"),
            region: cfg.get("s3_region") || "us-east-1",
            endpoint: cfg.get("s3_endpoint"), // Optional for S3-compatible storage
        },
    });
}

// Create load balancer for multi-control-plane high availability
const enableControlPlaneLB = cfg.getBoolean("enableControlPlaneLB") ?? true;
const controlPlaneLB = enableControlPlaneLB
    ? new ControlPlaneLoadBalancer("control-plane-lb", {
        masterNodes: [
            { name: "tethys", ip: cfg.require("tethysIp"), hostname: "srv712429" },
            { name: "styx", ip: cfg.require("styxIp"), hostname: "srv712695" },
        ],
        k8sProvider,
        enableHealthChecks: true,
    }, { dependsOn: cluster ? [cluster] : [] })
    : undefined;

// =============================================================================
// INFRASTRUCTURE COMPONENTS
// =============================================================================

const labelHostname = pulumi.interpolate`label.${clusterConfig.nodeTunnel.hostname}`;
const gpuHostname = pulumi.interpolate`gpu.${clusterConfig.nodeTunnel.hostname}`;
const airflowHostname = pulumi.interpolate`airflow.${clusterConfig.nodeTunnel.hostname}`;
const minioHostname = pulumi.interpolate`minio.${clusterConfig.nodeTunnel.hostname}`;
const enableAppsStack = cfg.getBoolean("enableAppsStack") ?? false;

const extraIngressRules: Array<{ hostname: pulumi.Input<string>; service: pulumi.Input<string>; noTLSVerify?: pulumi.Input<boolean> }>= [
    { hostname: labelHostname, service: pulumi.output("http://label-studio.apps.svc.cluster.local:8080"), noTLSVerify: false },
    // Note: GPU service is handled by HostCloudflared on Calypso, not this tunnel
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
const enableLabelStudioAccess = cfg.getBoolean("enableLabelStudioAccess") ?? false;

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

// Apply Access to Label Studio if enabled and rules provided
if (enableLabelStudioAccess && (accessAllowedEmailDomain || (accessAllowedEmails && accessAllowedEmails.length > 0))) {
    accessForHost(labelHostname, "label-studio");
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
        }, { provider: k8sProvider });

        // Bootstrap schemas/tables for control/raw/stage/label/curated
        const dbUrl = pulumi.interpolate`postgresql://postgres:${pgPassword}@postgres.${namespaceName}.svc.cluster.local:5432/postgres`;
        new DbBootstrap("db-bootstrap", { k8sProvider, namespace: namespaceName, dbUrl }, { dependsOn: [pg] });
    }
    // MinIO/Airflow intentionally skipped per ops decision; add flags later if needed.
}

// =============================================================================
// CRUNCHYBRIDGE DATABASE PROVISIONING + MIGRATIONS
// =============================================================================

// Provision CrunchyBridge managed PostgreSQL cluster via IaC
const enableCrunchyBridgeProvisioning = cfg.getBoolean("enableCrunchyBridgeProvisioning") ?? false;
let crunchyCluster: CrunchyBridgeCluster | undefined;
let crunchyDbUrl: pulumi.Output<string>;

if (enableCrunchyBridgeProvisioning) {
    crunchyCluster = new CrunchyBridgeCluster("ebisu", {
        applicationId: cfg.requireSecret("crunchybridge_app_id"),
        applicationSecret: cfg.requireSecret("crunchybridge_app_secret"),
        teamId: cfg.requireSecret("crunchybridge_team_id"),
        name: "ebisu",
        provider: "aws",
        region: "us-east-2",
        planId: "hobby-2", // 4GB RAM, 1 vCPU, 50GB storage
        majorVersion: 17,
        storage: 50,
        isHa: false,
    });
    crunchyDbUrl = crunchyCluster.outputs.connectionUrl;
} else {
    // Use existing database URL from config (manual provisioning)
    crunchyDbUrl = cfg.requireSecret("postgres_url");
}

// Apply database migrations (V3-V6) via Kubernetes Jobs
const enableDatabaseMigrations = cfg.getBoolean("enableDatabaseMigrations") ?? true;

if (enableDatabaseMigrations) {
    new DatabaseMigrations("crunchybridge-migrations", {
        k8sProvider,
        namespace: namespaceName,
        dbUrl: crunchyDbUrl,
        migrationsPath: "../../../sql/migrations", // Relative to compiled dist/src/components/
        enableSeedData: true,
    }, { dependsOn: crunchyCluster ? [crunchyCluster] : [] });
}

const flux = new FluxBootstrap("gitops", {
    cluster: clusterConfig,
    k8sProvider,
});

const pko = new PulumiOperator("pko", {
    cluster: clusterConfig,
    k8sProvider,
});

const imageAutomation = new ImageAutomation("version-monitor", {
    cluster: clusterConfig,
    k8sProvider,
    fluxNamespace: "flux-system",
}, { dependsOn: [flux] });

// Deploy node tunnels for bidirectional pod networking (especially for Calypso GPU node)
const enableNodeTunnels = cfg.getBoolean("enableNodeTunnels") ?? true;
let nodeTunnels: NodeTunnels | undefined;
if (enableNodeTunnels) {
    nodeTunnels = new NodeTunnels("node-tunnels", {
        cluster: clusterConfig,
        k8sProvider,
        cloudflareProvider,
    });
}

// Deploy Label Studio on the control-plane VPS (Kubernetes)
// Triton adapter (in-cluster) bridging LS -> Triton HTTP v2
const tritonBaseUrl = pulumi.interpolate`https://${clusterConfig.nodeTunnel.hostnames.gpu}`;
const lsAdapter = new LsTritonAdapter("ls-triton-adapter", {
    k8sProvider,
    tritonBaseUrl,
});

const labelStudio = new LabelStudio("label-studio", {
    k8sProvider,
    mlBackendUrl: pulumi.interpolate`${lsAdapter.serviceUrl}/predict_ls`,
});

// SME Readiness - Configure boathou.se domain with Cloudflare Access
const enableSMEAccess = cfg.getBoolean("enableLabelStudioAccess") ?? true;
const smeEmailDomain = cfg.get("accessAllowedEmailDomain") ?? "boathou.se";

const smeReadiness = new SMEReadiness("sme-ready", {
    cloudflareProvider,
    zoneId: clusterConfig.cloudflare.zoneId,
    tunnelId: clusterConfig.cloudflare.tunnelId,
    nodeTunnelId: clusterConfig.nodeTunnel.tunnelId,
    emailDomain: smeEmailDomain,
    enableLabelStudioAccess: enableSMEAccess,
});

// Annotations sink: receives LS webhooks, appends JSONL to HF dataset and upserts into Postgres
const hfRepo = cfg.get("hfDatasetRepo") || "goldfish-inc/oceanid-annotations";
const hfToken = cfg.getSecret("hfAccessToken");
const pgPassword = cfg.getSecret("postgres_password");
const postgresUrl = cfg.getSecret("postgres_url"); // External (e.g., CrunchyBridge)
const dbUrl = (postgresUrl as any) || (pgPassword ? pulumi.interpolate`postgresql://postgres:${pgPassword}@postgres.apps.svc.cluster.local:5432/postgres` : undefined as any);
const schemaVersion = cfg.get("schemaVersion") || "1.0.0";
const annotationsSink = new AnnotationsSink("annotations-sink", {
    k8sProvider,
    hfRepo,
    hfToken,
    dbUrl,
    schemaVersion,
});

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
    const tritonImage = cfg.get("tritonImage") || "ghcr.io/triton-inference-server/server:2.60.0-py3";
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

    // Ensure gpu.<base> DNS exists when NodeTunnels are disabled
    if (!enableNodeTunnels) {
        new cloudflare.DnsRecord("host-gpu-cname", {
            zoneId: clusterConfig.cloudflare.zoneId,
            name: clusterConfig.nodeTunnel.hostnames.gpu,
            type: "CNAME",
            content: clusterConfig.nodeTunnel.target,
            proxied: true,
            ttl: 1,
            comment: pulumi.interpolate`GPU access for ${clusterConfig.name} host connector`,
        }, { provider: cloudflareProvider });
    }

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
    labelStudio: smeReadiness.labelStudioUrl,
    gpuServices: smeReadiness.gpuServiceUrl,
    adapterHealth: pulumi.interpolate`${lsAdapter.serviceUrl}/healthz`,
    annotationsWebhook: pulumi.interpolate`${annotationsSink.serviceUrl}/webhook`,
};

export const smeAccess = {
    emailDomain: smeEmailDomain,
    accessEnabled: enableSMEAccess,
    accessPolicyId: smeReadiness.accessPolicyId,
};

export const modelConfiguration = {
    nerLabels: cfg.getSecret("nerLabels") ?? pulumi.secret(JSON.stringify([
        "O","VESSEL","VESSEL_NAME","IMO","IRCS","MMSI","FLAG","PORT",
        "ORGANIZATION","PERSON","COMPANY","BENEFICIAL_OWNER","OPERATOR",
        "CHARTERER","VESSEL_MASTER","CREW_MEMBER","GEAR_TYPE","VESSEL_TYPE",
        "COMMODITY","HS_CODE","SPECIES","RISK_LEVEL","SANCTION","DATE",
        "LOCATION","COUNTRY","RFMO","LICENSE","TONNAGE","LENGTH","ENGINE_POWER"
    ])),
    nerLabelCount: 63,
    bertModelDimensions: "[batch_size, sequence_length, 63]",
};

// =============================================================================
// SCRIPT RETIREMENT MIGRATION
// =============================================================================

// Create migration orchestrator to manage script retirement
const migration = enableMigration
    ? new MigrationOrchestrator("script-retirement", {
        cluster: clusterConfig,
        k8sProvider,
        escEnvironment: "default/oceanid-cluster",
        migrationPhase: cfg.get("migration_phase") as any || "preparation",
        enableSSHRotation: true,
        enableK3sRotation: true,
        enableSecurityHardening: true,
        enableCredentialSync: true,
        enableFluxSelfInstall: true,
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
    }, { dependsOn: ((() => { const deps: pulumi.Resource[] = [flux, pko, imageAutomation]; if (controlPlaneLB) deps.unshift(controlPlaneLB); return deps; })()) })
    : undefined;

export const outputs = {
    // Cluster provisioning
    clusterReady: cluster ? cluster.outputs.clusterReady : pulumi.output(false),
    masterEndpoint: cluster ? cluster.outputs.masterEndpoint : pulumi.output(""),
    nodeProvisioningStatus: cluster ? cluster.outputs.provisioningStatus : pulumi.output({}),

    // High availability
    controlPlaneLB: controlPlaneLB ? controlPlaneLB.outputs.loadBalancerIP : pulumi.output(""),
    controlPlaneHealthStatus: controlPlaneLB ? controlPlaneLB.outputs.healthStatus : pulumi.output({}),

    // Infrastructure
    kubeconfigPath,
    cloudflareNamespace: tunnel.outputs.namespace,
    cloudflareDeployment: tunnel.outputs.deploymentName,
    cloudflareMetricsService: tunnel.outputs.metricsServiceName,
    cloudflareDnsRecord: tunnel.outputs.dnsRecordName,
    labelStudioHostname: labelHostname,
    calypsoTritonReady: calypsoTriton ? calypsoTriton.serviceReady : pulumi.output(false),
    nodeTunnelNamespace: nodeTunnels ? nodeTunnels.outputs.namespace : pulumi.output(""),
    nodeTunnelDaemonSet: nodeTunnels ? nodeTunnels.outputs.daemonSetName : pulumi.output(""),
    nodeTunnelMetricsService: nodeTunnels ? nodeTunnels.outputs.metricsServiceName : pulumi.output(""),
    nodeTunnelDnsRecords: nodeTunnels ? nodeTunnels.outputs.dnsRecords : pulumi.output({}),
    lsMlBackendUrl: lsAdapter.serviceUrl,
    fluxNamespace: flux.namespace,
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
