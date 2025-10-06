import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface ProjectBootstrapperArgs {
  k8sProvider: k8s.Provider;
  namespace?: string;
  serviceName?: string;
  replicas?: number;
  // Label Studio
  labelStudioUrl: pulumi.Input<string>; // e.g., https://label.boathou.se
  labelStudioPat: pulumi.Input<string>; // Personal Access Token (PAT)
  // ML backends
  nerBackendUrl: pulumi.Input<string>; // e.g., http://ls-triton-adapter.apps.svc.cluster.local:9090
  tabertBackendUrl?: pulumi.Input<string>; // optional experimental backend
  // Annotations sink endpoints (optional verify/registration)
  sinkIngestUrl?: pulumi.Input<string>; // e.g., http://annotations-sink.apps.svc.cluster.local:8080/ingest
  sinkWebhookUrl?: pulumi.Input<string>; // e.g., http://annotations-sink.apps.svc.cluster.local:8080/webhook
  // Labels (JSON array of strings). If omitted, service will fall back to labels.json baked in image/env
  nerLabelsJson?: pulumi.Input<string>;
  // CORS allowed origins (Label Studio URL, docs site URL)
  allowedOrigins?: pulumi.Input<string[]>;
}

export class ProjectBootstrapper extends pulumi.ComponentResource {
  public readonly serviceUrl!: pulumi.Output<string>;
  public readonly serviceName!: pulumi.Output<string>;

  constructor(name: string, args: ProjectBootstrapperArgs, opts?: pulumi.ComponentResourceOptions) {
    super("oceanid:apps:ProjectBootstrapper", name, {}, opts);

    const {
      k8sProvider,
      namespace = "apps",
      serviceName = "project-bootstrapper",
      replicas = 1,
      labelStudioUrl,
      labelStudioPat,
      nerBackendUrl,
      tabertBackendUrl,
      sinkIngestUrl,
      sinkWebhookUrl,
      nerLabelsJson,
      allowedOrigins = ["https://label.boathou.se"],
    } = args;

    const labels = { app: serviceName };

    // Python app served by uvicorn (no runtime pip installs; stdlib urllib is used)
    const appPy = `
import os, json
import urllib.request, urllib.error
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

LS_URL = os.getenv("LS_URL")
LS_PAT = os.getenv("LS_PAT")
NER_BACKEND_URL = os.getenv("NER_BACKEND_URL")
TABERT_BACKEND_URL = os.getenv("TABERT_BACKEND_URL")
SINK_INGEST_URL = os.getenv("SINK_INGEST_URL")
SINK_WEBHOOK_URL = os.getenv("SINK_WEBHOOK_URL")
NER_LABELS_JSON = os.getenv("NER_LABELS_JSON")

app = FastAPI()

origins = json.loads(os.getenv("ALLOWED_ORIGINS", "[]") or "[]")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _labels():
    if NER_LABELS_JSON:
        try:
            arr = json.loads(NER_LABELS_JSON)
            if isinstance(arr, list):
                return [str(x) for x in arr]
        except Exception:
            pass
    return ["VESSEL_NAME","IMO","MMSI","IRCS","PORT","DATE","COMPANY","FLAG"]

def _label_config_xml(labels):
    inner = "\n".join([f"    <Label value=\"{l}\"/>" for l in labels])
    return (
        "<View>\n"
        "  <Header value=\"Vessel Record - NER Annotation\"/>\n"
        "  <Text name=\"text\" value=\"$text\" granularity=\"word\"/>\n"
        "  <Labels name=\"label\" toName=\"text\" showInline=\"true\">\n"
        f"{inner}\n"
        "  </Labels>\n"
        "</View>"
    )

def _http(method: str, url: str, headers=None, data=None):
    headers = headers or {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.getcode(), resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        return e.code, body

def _access_token():
    code, body = _http("POST", f"{LS_URL.rstrip('/')}/api/token/refresh", headers={"Content-Type":"application/json"}, data=json.dumps({"refresh": LS_PAT}).encode("utf-8"))
    if code != 200:
        raise HTTPException(502, f"Token refresh failed: {code} {body}")
    return json.loads(body).get("access")

def _ensure_webhooks(h: dict):
    if not (SINK_INGEST_URL or SINK_WEBHOOK_URL):
        return
    code, body = _http("GET", f"{LS_URL.rstrip('/')}/api/webhooks", headers=h)
    if code != 200:
        return
    try:
        existing = json.loads(body) or []
    except Exception:
        existing = []
    def has_url(u: str) -> bool:
        return any(isinstance(x, dict) and x.get('url') == u for x in existing)
    if SINK_INGEST_URL and not has_url(SINK_INGEST_URL):
        _http("POST", f"{LS_URL.rstrip('/')}/api/webhooks", headers=h, data=json.dumps({
            "url": SINK_INGEST_URL, "send_payload": True,
            "events": ["TASK_CREATED","TASKS_BULK_CREATED"],
        }).encode("utf-8"))
    if SINK_WEBHOOK_URL and not has_url(SINK_WEBHOOK_URL):
        _http("POST", f"{LS_URL.rstrip('/')}/api/webhooks", headers=h, data=json.dumps({
            "url": SINK_WEBHOOK_URL, "send_payload": True,
            "events": ["ANNOTATION_CREATED","ANNOTATION_UPDATED","ANNOTATION_DELETED"],
        }).encode("utf-8"))

@app.post("/create")
def create_project(title: str, description: Optional[str] = None, tabert: bool = False):
    if not (LS_URL and LS_PAT and NER_BACKEND_URL):
        raise HTTPException(500, "Service not configured")
    token = _access_token()
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Create project
    code, body = _http("POST", f"{LS_URL.rstrip('/')}/api/projects/", headers=h, data=json.dumps({
        "title": title, "description": description or ("TABERT experimental" if tabert else None),
    }).encode("utf-8"))
    if code not in (200,201):
        raise HTTPException(502, f"Create project failed: {code} {body}")
    pid = json.loads(body).get("id")

    # Apply labeling interface
    xml = _label_config_xml(_labels())
    code, body = _http("PATCH", f"{LS_URL.rstrip('/')}/api/projects/{pid}", headers=h, data=json.dumps({
        "label_config": xml, "show_collab_predictions": True, "model_version": "latest"
    }).encode("utf-8"))
    if code not in (200,201):
        raise HTTPException(502, f"Apply label config failed: {code} {body}")

    # Connect NER backend
    code, body = _http("GET", f"{LS_URL.rstrip('/')}/api/ml?project={pid}", headers=h)
    exists = False
    try:
        exists = any(isinstance(b, dict) and b.get("url") == NER_BACKEND_URL for b in json.loads(body) or [])
    except Exception:
        exists = False
    if not exists:
        code, body = _http("POST", f"{LS_URL.rstrip('/')}/api/ml", headers=h, data=json.dumps({
            "url": NER_BACKEND_URL, "project": pid, "title": "Triton NER",
            "description": "DistilBERT NER via adapter", "is_interactive": True
        }).encode("utf-8"))
        if code not in (200,201):
            raise HTTPException(502, f"Connect NER backend failed: {code} {body}")

    # Optional: TaBERT
    if tabert and TABERT_BACKEND_URL:
        _http("POST", f"{LS_URL.rstrip('/')}/api/ml", headers=h, data=json.dumps({
            "url": TABERT_BACKEND_URL, "project": pid, "title": "TaBERT (experimental)",
            "description": "Experimental table normalization", "is_interactive": True
        }).encode("utf-8"))

    _ensure_webhooks(h)
    return {"project_id": pid, "project_url": f"{LS_URL.rstrip('/')}/projects/{pid}"}

@app.get("/health")
def health():
    return {"ok": True}
`;

    // Provide app code via ConfigMap and mount to /app
    const codeCm = new k8s.core.v1.ConfigMap(`${serviceName}-code`, {
      metadata: { name: `${serviceName}-code`, namespace },
      data: { "main.py": appPy },
    }, { provider: k8sProvider, parent: this });

    const deploy = new k8s.apps.v1.Deployment(`${serviceName}-deploy`, {
      metadata: { name: serviceName, namespace },
      spec: {
        replicas,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            containers: [
              {
                name: serviceName,
                image: "tiangolo/uvicorn-gunicorn-fastapi:python3.11", // includes fastapi+uvicorn
                ports: [{ name: "http", containerPort: 80 }],
                env: [
                  { name: "LS_URL", value: labelStudioUrl as any },
                  { name: "LS_PAT", value: labelStudioPat as any },
                  { name: "NER_BACKEND_URL", value: nerBackendUrl as any },
                  ...(tabertBackendUrl ? [{ name: "TABERT_BACKEND_URL", value: tabertBackendUrl as any }] : []),
                  ...(sinkIngestUrl ? [{ name: "SINK_INGEST_URL", value: sinkIngestUrl as any }] : []),
                  ...(sinkWebhookUrl ? [{ name: "SINK_WEBHOOK_URL", value: sinkWebhookUrl as any }] : []),
                  ...(nerLabelsJson ? [{ name: "NER_LABELS_JSON", value: nerLabelsJson as any }] : []),
                  { name: "ALLOWED_ORIGINS", value: pulumi.output(allowedOrigins).apply(a => JSON.stringify(a)) as any },
                  { name: "APP_MODULE", value: "main:app" },
                ],
                volumeMounts: [{ name: "code", mountPath: "/app" }],
                resources: { requests: { cpu: "50m", memory: "128Mi" }, limits: { cpu: "200m", memory: "256Mi" } },
              },
            ],
            volumes: [{ name: "code", configMap: { name: `${serviceName}-code` } }],
          },
        },
      },
    }, { provider: k8sProvider, parent: this, dependsOn: [codeCm] });

    const svc = new k8s.core.v1.Service(`${serviceName}-svc`, {
      metadata: { name: serviceName, namespace },
      spec: {
        selector: labels,
        ports: [{ name: "http", port: 8080, targetPort: "http" }],
      },
    }, { provider: k8sProvider, parent: this, dependsOn: [deploy] });

    this.serviceName = svc.metadata.name;
    this.serviceUrl = pulumi.interpolate`http://${svc.metadata.name}.${namespace}.svc.cluster.local:8080`;
    this.registerOutputs({ serviceName: this.serviceName, serviceUrl: this.serviceUrl });
  }
}
