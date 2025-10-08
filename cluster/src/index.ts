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
import { HostDockerService } from "./components/hostDockerService";
import { HostModelPuller } from "./components/hostModelPuller";
import { LsTritonAdapter } from "./components/lsTritonAdapter";
import { LabelStudioSecrets } from "./components/labelStudioSecrets";
import { getSentrySettings, toEnvVars } from "./sentry-config";
import { K3sCluster, NodeConfig } from "./components/k3sCluster";
import { ControlPlaneLoadBalancer } from "./components/controlPlaneLoadBalancer";
import { MigrationOrchestrator } from "./components/migrationOrchestrator";
import { NodeTunnels } from "./components/nodeTunnels";
import { SMEReadiness } from "./components/smeReadiness";
import { AnnotationsSink } from "./components/annotationsSink";
import { DbBootstrap } from "./components/dbBootstrap";
import { ProjectBootstrapper } from "./components/projectBootstrapper";

// =============================================================================
// CLUSTER PROVISIONING
// =============================================================================
// NOTE: CI guard is in providers.ts to catch GitHub Actions before kubeconfig loading

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
    { hostname: labelHostname, service: pulumi.output("http://label-studio.apps.svc.cluster.local:8080"), noTLSVerify: false }, // Service deployed by Flux
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

// Deploy Label Studio on the control-plane VPS (Kubernetes)
// Triton adapter (in-cluster) bridging LS -> Triton HTTP v2
const tritonBaseUrl = pulumi.interpolate`https://${clusterConfig.nodeTunnel.hostnames.gpu}`;

// Inject CF Access service token headers into adapter if provided via ESC
const cfAccessClientIdOut = cfg.getSecret("cfAccessClientId") as any;
const cfAccessClientSecretOut = cfg.getSecret("cfAccessClientSecret") as any;

const lsAdapter = new LsTritonAdapter("ls-triton-adapter", {
    k8sProvider,
    tritonBaseUrl,
    cfAccessClientId: (cfAccessClientIdOut as any) ?? undefined,
    cfAccessClientSecret: (cfAccessClientSecretOut as any) ?? undefined,
});

// Label Studio deployment moved to GitOps (Flux)
// See clusters/tethys/apps/label-studio-release.yaml
// Secrets are synced from ESC to Kubernetes for Flux to consume
const labelStudioDbUrl = cfg.getSecret("labelStudioDbUrl");
const awsAccessKeyId = cfg.getSecret("aws.labelStudio.accessKeyId");
const awsSecretAccessKey = cfg.getSecret("aws.labelStudio.secretAccessKey");
const awsBucketName = cfg.get("aws.labelStudio.bucketName") || "labelstudio-goldfish-uploads";
const awsRegion = cfg.get("aws.labelStudio.region") || "us-east-1";

// Sync ESC secrets to Kubernetes for Flux-managed Label Studio
let labelStudioSecrets: LabelStudioSecrets | undefined;
if (labelStudioDbUrl && awsAccessKeyId && awsSecretAccessKey) {
    labelStudioSecrets = new LabelStudioSecrets("label-studio-secrets", {
        k8sProvider,
        namespace: namespaceName,
        labelStudioDbUrl: labelStudioDbUrl as any,
        awsAccessKeyId: awsAccessKeyId as any,
        awsSecretAccessKey: awsSecretAccessKey as any,
        awsBucketName,
        awsRegion,
    });
}

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
        }, { provider: k8sProvider });
    }
})();
// In-cluster one-off provisioner Job to configure Label Studio project "NER_Data"
// - Connects ML backend
// - Applies full NER labeling interface from ESC/labels.json
// - Imports a sample text task (for verification)
// Gate behind config to avoid surprises on every deploy
(() => {
    const cfg = new pulumi.Config();
    const enableLsProvisionerJob = cfg.getBoolean("enableLsProvisionerJob");
    // Default true to preserve current behavior; set to false to disable
    if (enableLsProvisionerJob === false) {
        return;
    }
    const cfgLS = new pulumi.Config();
    const lsPat = cfgLS.getSecret("labelStudioPat");
    if (!lsPat) {
        return; // Skip if PAT not provided; can be added later via ESC
    }

    const provisionerCode = `
import argparse
import json
import os
import sys
import urllib.request

def http(method: str, url: str, headers=None, data=None):
    headers = headers or {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8")
            return resp.getcode(), body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        return e.code, body

def access_token(ls_url: str, pat: str) -> str:
    code, body = http("POST", f"{ls_url.rstrip('/')}/api/token/refresh", headers={"Content-Type":"application/json"}, data=json.dumps({"refresh":pat}).encode("utf-8"))
    if code != 200:
        print(f"Token refresh failed: {code} {body}", file=sys.stderr)
        sys.exit(2)
    return json.loads(body)["access"]

def label_config_xml(labels):
    tags = "\n".join([f"      <Label value=\"{l}\"/>" for l in labels])
    return (
        "<View>\n"
        "  <Header value=\"Document Text\"/>\n"
        "  <Text name=\"text\" value=\"$text\"/>\n"
        "  <Labels name=\"label\" toName=\"text\" showInline=\"true\">\n"
        f"{tags}\n"
        "  </Labels>\n"
        "  <Relations name=\"rels\" toName=\"text\"/>\n"
        "</View>"
    )

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--title", required=True)
    p.add_argument("--description", default=None)
    args = p.parse_args()

    ls_url = os.getenv("LABEL_STUDIO_URL") or "http://label-studio.apps.svc.cluster.local:8080"
    pat = os.getenv("LABEL_STUDIO_PAT")
    backend_url = os.getenv("ML_BACKEND_URL") or "http://ls-triton-adapter.apps.svc.cluster.local:9090"
    if not pat:
        print("LABEL_STUDIO_PAT not set", file=sys.stderr)
        sys.exit(1)
    token = access_token(ls_url, pat)
    auth = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Find project by title
    code, body = http("GET", f"{ls_url.rstrip('/')}/api/projects/", headers=auth)
    if code != 200:
        print(f"List projects failed: {code} {body}", file=sys.stderr)
        sys.exit(2)
    pid = None
    try:
        projects = json.loads(body)
        for proj in projects:
            if isinstance(proj, dict) and proj.get("title") == args.title:
                pid = proj.get("id")
                break
    except Exception as e:
        print(f"Parse projects error: {e}", file=sys.stderr)
        sys.exit(2)
    if not pid:
        print("Project not found: "+args.title, file=sys.stderr)
        sys.exit(3)

    # Ensure ML backend
    code, body = http("GET", f"{ls_url.rstrip('/')}/api/ml?project={pid}", headers=auth)
    if code != 200:
        print(f"List ML backends failed: {code} {body}", file=sys.stderr)
        sys.exit(4)
    try:
        exists = any(isinstance(b, dict) and b.get("url") == backend_url for b in json.loads(body))
    except Exception:
        exists = False
    if not exists:
        payload = json.dumps({"url": backend_url, "project": pid, "title": "Triton Inference Adapter", "description": "NER + Docling predictions", "is_interactive": True}).encode("utf-8")
        code, body = http("POST", f"{ls_url.rstrip('/')}/api/ml", headers=auth, data=payload)
        if code not in (200,201):
            print(f"Add ML backend failed: {code} {body}", file=sys.stderr)
            sys.exit(5)

    # Apply label config
    labels_env = os.getenv("NER_LABELS")
    labels = []
    if labels_env:
        try:
            labels = [str(x) for x in json.loads(labels_env)]
        except Exception:
            labels = []
    if not labels:
        labels = ["VESSEL_NAME","IMO","MMSI","IRCS","PORT","DATE","COMPANY","FLAG"]
    xml = label_config_xml(labels)
    body = {"label_config": xml}
    if args.description:
        body["description"] = args.description
    code, resp = http("PATCH", f"{ls_url.rstrip('/')}/api/projects/{pid}", headers=auth, data=json.dumps(body).encode("utf-8"))
    if code not in (200,201):
        print(f"Patch project failed: {code} {resp}", file=sys.stderr)
        sys.exit(6)

    # Import sample task (optional)
    sample = [{"data": {"text": "Vessel NEREUS IMO 8819421 arrived at BURELA on 2023-01-01."}}]
    code, _ = http("POST", f"{ls_url.rstrip('/')}/api/projects/{pid}/import", headers=auth, data=json.dumps(sample).encode("utf-8"))
    print(f"Provisioned project {pid} with {len(labels)} labels (import status {code})")

    # Register ingest webhook for tasks created (to write raw docs to stage.*)
    sink_url = os.getenv("SINK_INGEST_URL") or "http://annotations-sink.apps.svc.cluster.local:8080/ingest"
    code, body = http("GET", f"{ls_url.rstrip('/')}/api/webhooks", headers=auth)
    if code == 200:
        try:
            hooks = json.loads(body)
        except Exception:
            hooks = []
        need = True
        for h in hooks:
            if isinstance(h, dict) and h.get("url") == sink_url:
                need = False
                break
        if need:
            payload = json.dumps({
                "url": sink_url,
                "send_payload": True,
                "send_for_all_actions": False,
                "is_active": True,
                "actions": ["TASK_CREATED","TASKS_BULK_CREATED"],
                "headers": {}
            }).encode("utf-8")
            code, body = http("POST", f"{ls_url.rstrip('/')}/api/webhooks", headers=auth, data=payload)
            print(f"Webhook create status: {code}")

if __name__ == "__main__":
    main()
`;

    const provConfig = new k8s.core.v1.ConfigMap("ls-provisioner-code", {
        metadata: { name: "ls-provisioner-code", namespace: "apps" },
        data: { "provision.py": provisionerCode },
    }, { provider: k8sProvider, ignoreChanges: ["spec"] as any });

    const provSecret = new k8s.core.v1.Secret("ls-provisioner-secret", {
        metadata: { name: "ls-provisioner-secret", namespace: "apps" },
        stringData: { LABEL_STUDIO_PAT: lsPat as any },
    }, { provider: k8sProvider });

    new k8s.batch.v1.Job("ls-provisioner-ner-data", {
        metadata: { name: "ls-provisioner-ner-data", namespace: "apps" },
        spec: {
            backoffLimit: 1,
            template: {
                metadata: { labels: { app: "ls-provisioner" } },
                spec: {
                    restartPolicy: "Never",
                    containers: [{
                        name: "provision",
                        image: "python:3.11-slim",
                        command: ["python", "/app/provision.py", "--title", "NER_Data", "--description", "Universal document NER (PDF, CSV, XLSX, text). Pre-labels via adapter; SMEs review & approve."],
                        env: [
                            { name: "LABEL_STUDIO_URL", value: "http://label-studio.apps.svc.cluster.local:8080" },
                            { name: "ML_BACKEND_URL", value: pulumi.interpolate`${lsAdapter.serviceUrl}` as any },
                            ...(cfg.get("nerLabels") ? [{ name: "NER_LABELS", value: cfg.get("nerLabels")! }] : []),
                            { name: "LABEL_STUDIO_PAT", valueFrom: { secretKeyRef: { name: provSecret.metadata.name, key: "LABEL_STUDIO_PAT" } } },
                        ] as any,
                        volumeMounts: [{ name: "code", mountPath: "/app" }],
                    }],
                    volumes: [{ name: "code", configMap: { name: provConfig.metadata.name } }],
                },
            },
        },
    }, { provider: k8sProvider, dependsOn: [lsAdapter, provConfig, provSecret] }); // labelStudio removed - managed by Flux
})();

// Verification: List webhooks and confirm NER_Data exists (runs once)
(() => {
    const cfg = new pulumi.Config();
    const enableLsVerifyJob = cfg.getBoolean("enableLsVerifyJob");
    if (enableLsVerifyJob === false) {
        return;
    }
    const cfgLS = new pulumi.Config();
    const lsPat = cfgLS.getSecret("labelStudioPat");
    if (!lsPat) return;
    const code = `
import json, os, sys
import urllib.request
def http(m,u,h=None,d=None):
    r=urllib.request.Request(u,data=d,headers=h or {},method=m)
    with urllib.request.urlopen(r,timeout=20) as resp:
        print(resp.getcode()); print(resp.read().decode('utf-8')[:2000])
pat=os.getenv('LABEL_STUDIO_PAT'); ls=os.getenv('LABEL_STUDIO_URL')
data=json.dumps({'refresh':pat}).encode('utf-8')
req=urllib.request.Request(ls.rstrip('/')+'/api/token/refresh',data=data,headers={'Content-Type':'application/json'})
with urllib.request.urlopen(req,timeout=20) as resp:
    tok=json.loads(resp.read().decode('utf-8'))['access']
h={'Authorization':f'Bearer {tok}'}
http('GET', ls.rstrip('/')+'/api/projects/', h)
http('GET', ls.rstrip('/')+'/api/webhooks', h)
`;
    const cm = new k8s.core.v1.ConfigMap("ls-verify-code", { metadata: { name: "ls-verify-code", namespace: "apps" }, data: { "verify.py": code } }, { provider: k8sProvider });
    const sec = new k8s.core.v1.Secret("ls-verify-secret", { metadata: { name: "ls-verify-secret", namespace: "apps" }, stringData: { LABEL_STUDIO_PAT: lsPat as any }}, { provider: k8sProvider });
    new k8s.batch.v1.Job("ls-verify", {
        metadata: { name: "ls-verify", namespace: "apps" },
        spec: {
            backoffLimit: 0,
            template: { metadata: { labels: { app: "ls-verify" } }, spec: { restartPolicy: "Never", containers: [{
                name: "verify", image: "python:3.11-slim",
                command: ["python", "/app/verify.py"],
                env: [
                    { name: "LABEL_STUDIO_URL", value: "http://label-studio.apps.svc.cluster.local:8080" },
                    { name: "LABEL_STUDIO_PAT", valueFrom: { secretKeyRef: { name: sec.metadata.name, key: "LABEL_STUDIO_PAT" } } },
                ] as any,
                volumeMounts: [{ name: "code", mountPath: "/app" }],
            }], volumes: [{ name: "code", configMap: { name: cm.metadata.name } }] } },
        }
    }, { provider: k8sProvider, dependsOn: [cm, sec] });
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
const enableSMEAccess = cfg.getBoolean("enableLabelStudioAccess") ?? false; // Default false - cloud stack owns Access
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
// Use the same labelfish database as Label Studio (now retrieved directly from ESC)
const annotationsSinkDbUrl = cfg.requireSecret("labelStudioDbUrl"); // Same database as Label Studio
const schemaVersion = cfg.get("schemaVersion") || "1.0.0";
const annotationsSink = new AnnotationsSink("annotations-sink", {
    k8sProvider,
    hfRepo,
    hfToken,
    dbUrl: annotationsSinkDbUrl,
    schemaVersion,
});

// Project Bootstrapper service: creates Label Studio projects via API with ML backend + webhooks
const enableProjectBootstrapperService = cfg.getBoolean("enableProjectBootstrapperService") ?? false;
let projectBootstrapper: ProjectBootstrapper | undefined;
if (enableProjectBootstrapperService) {
    const lsPat = cfg.getSecret("labelStudioPat");
    const nerLabelsJson = cfg.get("nerLabels");

    projectBootstrapper = new ProjectBootstrapper("project-bootstrapper", {
        k8sProvider,
        namespace: "apps",
        labelStudioUrl: "https://label.boathou.se", // External URL for webhooks
        labelStudioPat: lsPat as any,
        nerBackendUrl: lsAdapter.serviceUrl,
        sinkIngestUrl: pulumi.interpolate`${annotationsSink.serviceUrl}/ingest`,
        sinkWebhookUrl: pulumi.interpolate`${annotationsSink.serviceUrl}/webhook`,
        nerLabelsJson: nerLabelsJson as any,
        allowedOrigins: ["https://label.boathou.se"],
    });
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
    labelStudio: smeReadiness.labelStudioUrl,
    gpuServices: smeReadiness.gpuServiceUrl,
    adapterHealth: pulumi.interpolate`${lsAdapter.serviceUrl}/health`,
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
