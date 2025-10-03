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

    const appPy = `
import os
import json
from typing import Optional
import uvicorn
import httpx
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

def _labels() -> list[str]:
    if NER_LABELS_JSON:
        try:
            arr = json.loads(NER_LABELS_JSON)
            if isinstance(arr, list):
                return [str(x) for x in arr]
        except Exception:
            pass
    # Minimal fallback set
    return ["VESSEL_NAME","IMO","MMSI","IRCS","PORT","DATE","COMPANY","FLAG"]

def _label_config_xml(labels: list[str]) -> str:
    """
    Generate Label Studio config that works with CSV tasks (data blocks only, no meta).
    Uses flexible field references that work with any CSV column structure.
    """
    inner = "\n".join([f"    <Label value=\"{l}\"/>" for l in labels])

    # Generic config that works with both text tasks and CSV row tasks
    # Does NOT reference $meta, only $data fields
    return (
        "<View>\n"
        "  <Header value=\"Vessel Record - NER Annotation\"/>\n"
        "\n"
        "  <!-- Text display: works with CSV rows converted to text -->\n"
        "  <Text name=\"text\" value=\"$text\" granularity=\"word\" \n"
        "        highlightColor=\"#ff0000\"/>\n"
        "\n"
        "  <!-- NER entity labels -->\n"
        "  <Labels name=\"label\" toName=\"text\" showInline=\"true\">\n"
        f"{inner}\n"
        "  </Labels>\n"
        "</View>"
    )

async def _access_token(client: httpx.AsyncClient) -> str:
    r = await client.post(f"{LS_URL.rstrip('/')}/api/token/refresh", json={"refresh": LS_PAT})
    if r.status_code != 200:
        raise HTTPException(502, f"Token refresh failed: {r.text}")
    return r.json().get("access")

async def _ensure_webhooks(h: dict, client: httpx.AsyncClient):
    if not (SINK_INGEST_URL or SINK_WEBHOOK_URL):
        return
    r = await client.get(f"{LS_URL.rstrip('/')}/api/webhooks", headers=h)
    if r.status_code != 200:
        return
    existing = r.json() or []
    def has_url(u: str) -> bool:
        return any(isinstance(x, dict) and x.get('url') == u for x in existing)
    if SINK_INGEST_URL and not has_url(SINK_INGEST_URL):
        await client.post(f"{LS_URL.rstrip('/')}/api/webhooks", headers=h, json={
            "url": SINK_INGEST_URL, "send_payload": True,
            "events": ["TASK_CREATED","TASKS_BULK_CREATED"],
        })
    if SINK_WEBHOOK_URL and not has_url(SINK_WEBHOOK_URL):
        await client.post(f"{LS_URL.rstrip('/')}/api/webhooks", headers=h, json={
            "url": SINK_WEBHOOK_URL, "send_payload": True,
            "events": ["ANNOTATION_CREATED","ANNOTATION_UPDATED","ANNOTATION_DELETED"],
        })

@app.post("/create")
async def create_project(title: str, description: Optional[str] = None, tabert: bool = False):
    if not (LS_URL and LS_PAT and NER_BACKEND_URL):
        raise HTTPException(500, "Service not configured")
    async with httpx.AsyncClient(timeout=20.0) as client:
        token = await _access_token(client)
        h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Create project
        r = await client.post(f"{LS_URL.rstrip('/')}/api/projects/", headers=h, json={
            "title": title, "description": description or ("TABERT experimental" if tabert else None),
        })
        if r.status_code not in (200, 201):
            raise HTTPException(502, f"Create project failed: {r.text}")
        pid = r.json().get("id")

        # Apply labeling interface
        labels = _labels()
        xml = _label_config_xml(labels)
        r = await client.patch(f"{LS_URL.rstrip('/')}/api/projects/{pid}", headers=h, json={"label_config": xml,
            "show_collab_predictions": True, "model_version": "latest"})
        if r.status_code not in (200, 201):
            raise HTTPException(502, f"Apply label config failed: {r.text}")

        # Connect NER backend
        r = await client.get(f"{LS_URL.rstrip('/')}/api/ml", headers=h, params={"project": pid})
        if r.status_code != 200:
            raise HTTPException(502, f"List ML backends failed: {r.text}")
        exists = any(b.get("url") == NER_BACKEND_URL for b in r.json() or [])
        if not exists:
            r = await client.post(f"{LS_URL.rstrip('/')}/api/ml", headers=h, json={
                "url": NER_BACKEND_URL, "project": pid, "title": "Triton NER",
                "description": "DistilBERT NER via adapter", "is_interactive": True
            })
            if r.status_code not in (200, 201):
                raise HTTPException(502, f"Connect NER backend failed: {r.text}")

        # Optional: connect TaBERT backend
        if tabert and TABERT_BACKEND_URL:
            r = await client.post(f"{LS_URL.rstrip('/')}/api/ml", headers=h, json={
                "url": TABERT_BACKEND_URL, "project": pid, "title": "TaBERT (experimental)",
                "description": "Experimental table normalization", "is_interactive": True
            })
            # best-effort; do not fail hard

        # Ensure webhooks
        await _ensure_webhooks(h, client)

        return {"project_id": pid, "project_url": f"{LS_URL.rstrip('/')}/projects/{pid}"}

@app.get("/health")
async def health():
    return {"ok": True}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
`;

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
                image: "python:3.11-slim",
                ports: [{ name: "http", containerPort: 8080 }],
                env: [
                  { name: "LS_URL", value: labelStudioUrl as any },
                  { name: "LS_PAT", value: labelStudioPat as any },
                  { name: "NER_BACKEND_URL", value: nerBackendUrl as any },
                  ...(tabertBackendUrl ? [{ name: "TABERT_BACKEND_URL", value: tabertBackendUrl as any }] : []),
                  ...(sinkIngestUrl ? [{ name: "SINK_INGEST_URL", value: sinkIngestUrl as any }] : []),
                  ...(sinkWebhookUrl ? [{ name: "SINK_WEBHOOK_URL", value: sinkWebhookUrl as any }] : []),
                  ...(nerLabelsJson ? [{ name: "NER_LABELS_JSON", value: nerLabelsJson as any }] : []),
                  { name: "ALLOWED_ORIGINS", value: pulumi.output(allowedOrigins).apply(a => JSON.stringify(a)) as any },
                ],
                command: ["bash", "-lc"],
                args: [
                  "pip install fastapi uvicorn httpx && python - <<'PY'\n" + appPy + "\nPY\n",
                ],
                resources: { requests: { cpu: "50m", memory: "128Mi" }, limits: { cpu: "200m", memory: "256Mi" } },
              },
            ],
          },
        },
      },
    }, { provider: k8sProvider, parent: this });

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

