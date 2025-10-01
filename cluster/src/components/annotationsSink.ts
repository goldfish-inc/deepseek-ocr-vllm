import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as path from "path";
import * as fs from "fs";

export interface AnnotationsSinkArgs {
  k8sProvider: k8s.Provider;
  namespace?: string;
  serviceName?: string;
  replicas?: number;
  hfRepo?: pulumi.Input<string>; // e.g., goldfish-inc/oceanid-annotations
  hfToken?: pulumi.Input<string>; // Pulumi secret from ESC (preferred)
  dbUrl?: pulumi.Input<string>;   // Optional: postgres connection string
  schemaVersion?: pulumi.Input<string>; // e.g., 1.0.0
}

export class AnnotationsSink extends pulumi.ComponentResource {
  public readonly serviceUrl!: pulumi.Output<string>;
  public readonly serviceName!: pulumi.Output<string>;

  constructor(name: string, args: AnnotationsSinkArgs, opts?: pulumi.ComponentResourceOptions) {
    super("oceanid:apps:AnnotationsSink", name, {}, opts);

    const {
      k8sProvider,
      namespace = "apps",
      serviceName = "annotations-sink",
      replicas = 1,
      hfRepo = "goldfish-inc/oceanid-annotations",
      hfToken,
      dbUrl,
      schemaVersion = "1.0.0",
    } = args;

    // Try to load Ebisu schema mapping from repo
    const searchRoots = [path.resolve(process.cwd(), ".."), path.resolve(__dirname, "../../..")];
    function readFirstExisting(relPath: string): string | undefined {
      for (const root of searchRoots) {
        const p = path.join(root, relPath);
        try { if (fs.existsSync(p)) { return fs.readFileSync(p, "utf8"); } } catch {}
      }
      return undefined;
    }
    const ebisuSchema = readFirstExisting("adapter/ner/schema/ebisu_ner_schema_mapping.json");

    const appPy = `
import os
import json
import datetime as dt
from typing import Any, Dict, List

import asyncio
import uvicorn
from fastapi import FastAPI, Request
from pydantic import BaseModel

# Optional Postgres
DATABASE_URL = os.getenv("DATABASE_URL")
_pg_pool = None
try:
    if DATABASE_URL:
        import asyncpg  # type: ignore
    else:
        asyncpg = None
except Exception:
    asyncpg = None

from huggingface_hub import HfApi, create_repo, CommitOperationAdd

HF_TOKEN = os.getenv("HF_TOKEN")
HF_REPO = os.getenv("HF_REPO", "goldfish-inc/oceanid-annotations")
SCHEMA_VERSION = os.getenv("SCHEMA_VERSION", "1.0.0")
SUBDIR_TEMPLATE = os.getenv("SUBDIR_TEMPLATE", "annotations/{date}/project-{project_id}.jsonl")

SCHEMA_MAP_PATH = os.getenv("SCHEMA_MAP_PATH", "/app/schema/ebisu_ner_schema_mapping.json")
LABEL_TO_DB = {}
try:
    with open(SCHEMA_MAP_PATH, "r") as f:
        data = json.load(f)
        # Flatten simple mapping if present: {"LABEL": "table.column", ...}
        if isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, str):
                    LABEL_TO_DB[k] = v
                elif isinstance(v, dict) and "db_mapping" in v:
                    LABEL_TO_DB[k] = v.get("db_mapping")
except Exception:
    LABEL_TO_DB = {}

app = FastAPI()

class LSWebhook(BaseModel):
    event: str | None = None
    # accept arbitrary content

def _ensure_repo() -> bool:
    if not HF_TOKEN:
        # No token provided; skip HF init but keep serving
        return False
    api = HfApi(token=HF_TOKEN)
    try:
        api.repo_info(HF_REPO, repo_type="dataset")
        return True
    except Exception:
        try:
            create_repo(HF_REPO, repo_type="dataset", private=True, token=HF_TOKEN, exist_ok=True)
            return True
        except Exception as e:
            print(f"[WARN] Failed to initialize HF dataset repo '{HF_REPO}': {e}")
            return False

def _jsonl_path(project_id: Any) -> str:
    date = dt.date.today().strftime("%Y-%m-%d")
    subdir = SUBDIR_TEMPLATE.format(date=date, project_id=project_id)
    return subdir

def _to_spans(ls_ann: Dict[str, Any]) -> List[Dict[str, Any]]:
    spans = []
    results = ls_ann.get("result") or []
    for r in results:
        if r.get("type") not in ("labels", "labels_relation"):
            continue
        val = r.get("value") or {}
        labels = val.get("labels") or []
        start = val.get("start") or val.get("startOffset")
        end = val.get("end") or val.get("endOffset")
        text = val.get("text")
        if not labels or start is None or end is None:
            continue
        for label in labels:
            spans.append({
                "start": int(start),
                "end": int(end),
                "label": str(label),
                "text": text,
                "confidence": float(r.get("score", 1.0)),
                "db_mapping": LABEL_TO_DB.get(label)
            })
    return spans

async def _maybe_init_pg():
    global _pg_pool
    if not DATABASE_URL or asyncpg is None or _pg_pool is not None:
        return
    try:
        _pg_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)
    except Exception:
        # Degrade gracefully if DB is not reachable at startup; retry on first write.
        _pg_pool = None
        return
    try:
        async with _pg_pool.acquire() as conn:
            await conn.execute("""
            create schema if not exists control;
            create schema if not exists raw;
            create schema if not exists stage;
            create schema if not exists label;
            create schema if not exists curated;

            create table if not exists stage.documents (
                id bigserial primary key,
                external_id text,
                source text,
                content text,
                created_at timestamptz default now()
            );
            create table if not exists stage.extractions (
                id bigserial primary key,
                document_id bigint references stage.documents(id) on delete cascade,
                label text,
                value text,
                start int,
                "end" int,
                confidence double precision,
                db_mapping text,
                annotator text,
                updated_at timestamptz default now()
            );
            """)
    except Exception as e:
        print(f"[WARN] Failed to initialize DB schema at startup: {e}")

def _clean_to_extractions(doc: Dict[str, Any]):
    exts = []
    for s in doc.get("spans", []) or []:
        exts.append({
            "label": s.get("label"),
            "value": s.get("text"),
            "start": s.get("start"),
            "end": s.get("end"),
            "confidence": s.get("confidence"),
            "db_mapping": s.get("db_mapping"),
        })
    return exts

async def _insert_pg(doc: Dict[str, Any]):
    if not DATABASE_URL or asyncpg is None or _pg_pool is None:
        return
    spans = _clean_to_extractions(doc)
    async with _pg_pool.acquire() as conn:
        doc_id = await conn.fetchval(
            "insert into stage.documents(external_id, source, content) values($1,$2,$3) returning id",
            doc.get("metadata", {}).get("task_id"), doc.get("source"), doc.get("text")
        )
        for s in spans:
            await conn.execute(
                "insert into stage.extractions(document_id,label,value,start,\\"end\\",confidence,db_mapping,annotator) values($1,$2,$3,$4,$5,$6,$7,$8)",
                doc_id, s.get("label"), s.get("value"), s.get("start"), s.get("end"), s.get("confidence"), s.get("db_mapping"), doc.get("annotator")
            )

@app.on_event("startup")
async def on_start():
    print("[INFO] Starting up - skipping HF and DB init, will initialize on first request")
    # Skip blocking startup operations - initialize lazily on first request
    pass

@app.get("/health")
async def health():
    return {"ok": True}

@app.post("/webhook")
async def webhook(req: Request):
    # Lazy init on first request
    if HF_TOKEN and not _ensure_repo():
        print("[WARN] HF repo init failed, continuing without HF")
    await _maybe_init_pg()

    payload = await req.json()
    event = payload.get("event") or payload.get("action") or ""
    data = payload.get("annotation") or payload.get("data") or payload
    project_id = payload.get("project_id") or payload.get("project", {}).get("id") or "na"
    task = payload.get("task") or payload.get("data", {}).get("task") or {}
    text = None
    # common LS locations
    text = (task.get("data") or {}).get("text") or (payload.get("task", {}).get("data") or {}).get("text") or payload.get("text")
    annotator = (payload.get("annotation", {}) or {}).get("completed_by") or payload.get("user") or "unknown"

    spans = []
    if data:
        spans = _to_spans(data)

    doc = {
        "doc_id": task.get("id") or payload.get("task_id"),
        "text": text,
        "schema_version": SCHEMA_VERSION,
        "annotated_at": dt.datetime.utcnow().isoformat() + "Z",
        "annotator": str(annotator),
        "source": "label_studio",
        "spans": spans,
        "metadata": {
            "project_id": str(project_id),
            "task_id": str(task.get("id") or payload.get("task_id")),
        },
    }

    # Append to HF dataset jsonl (non-fatal on failure)
    hf_ok = False
    try:
        api = HfApi(token=HF_TOKEN)
        relpath = _jsonl_path(project_id)
        try:
            old = api.hf_hub_download(HF_REPO, relpath, repo_type="dataset", token=HF_TOKEN)
            with open(old, "r", encoding="utf-8") as f:
                prev = f.read().rstrip()
            content = prev + "\\n" + json.dumps(doc, ensure_ascii=False)
        except Exception:
            content = json.dumps(doc, ensure_ascii=False)
        op = CommitOperationAdd(path_in_repo=relpath, path_or_fileobj=content.encode("utf-8"), encoding=None)
        api.create_commit(repo_id=HF_REPO, repo_type="dataset", operations=[op], commit_message=f"append annotation {doc['metadata']['task_id']}")
        hf_ok = True
    except Exception as e:
        print(f"[WARN] Failed to append to HF dataset: {e}")

    await _insert_pg(doc)
    return {"ok": True, "hf_commit": hf_ok}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
`;

    const requirements = `fastapi==0.114.0\nuvicorn==0.30.6\nhuggingface_hub==0.23.0\nasyncpg==0.29.0\n`;

    const data: Record<string, string> = { "app.py": appPy, "requirements.txt": requirements };
    // ConfigMap keys must be flat; map via items in the volume spec
    const schemaKey = "schema_ebisu_ner_schema_mapping.json";
    if (ebisuSchema) data[schemaKey] = ebisuSchema;

    const code = new k8s.core.v1.ConfigMap(`${name}-code`, {
      metadata: { name: `${serviceName}-code`, namespace },
      data,
    }, { provider: k8sProvider, parent: this });

    // Secret for HF token if provided
    let hfSecret: k8s.core.v1.Secret | undefined;
    if (hfToken) {
      hfSecret = new k8s.core.v1.Secret(`${name}-hf`, {
        metadata: { name: `${serviceName}-hf-token`, namespace },
        stringData: { "token": pulumi.secret(hfToken) as any },
      }, { provider: k8sProvider, parent: this });
    }

    const env: any[] = [
      { name: "HF_REPO", value: hfRepo as any },
      { name: "SCHEMA_VERSION", value: schemaVersion as any },
      { name: "SUBDIR_TEMPLATE", value: "annotations/{date}/project-{project_id}.jsonl" },
      { name: "SCHEMA_MAP_PATH", value: "/app/schema/ebisu_ner_schema_mapping.json" },
    ];
    if (hfSecret) {
      env.push({ name: "HF_TOKEN", valueFrom: { secretKeyRef: { name: hfSecret.metadata.name, key: "token" } } });
    }
    if (dbUrl) {
      env.push({ name: "DATABASE_URL", value: dbUrl as any });
    }

    const deploy = new k8s.apps.v1.Deployment(`${name}-deploy`, {
      metadata: { name: serviceName, namespace },
      spec: {
        replicas,
        selector: { matchLabels: { app: serviceName } },
        template: {
          metadata: { labels: { app: serviceName } },
          spec: {
            volumes: [{ name: "code", configMap: {
              name: code.metadata.name,
              items: [
                { key: "app.py", path: "app.py" },
                { key: "requirements.txt", path: "requirements.txt" },
                ...(ebisuSchema ? [{ key: schemaKey, path: "schema/ebisu_ner_schema_mapping.json" }] : []),
              ],
            } }],
            containers: [{
              name: "sink",
              image: "python:3.11-slim",
              workingDir: "/app",
              env,
              volumeMounts: [{ name: "code", mountPath: "/app" }],
              command: ["bash", "-lc"],
              args: [
                "python -m venv /venv && /venv/bin/pip install --no-cache-dir -r requirements.txt && exec /venv/bin/uvicorn app:app --host 0.0.0.0 --port 8080"
              ],
              ports: [{ containerPort: 8080, name: "http" }],
              readinessProbe: { httpGet: { path: "/health", port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10 },
              livenessProbe: { httpGet: { path: "/health", port: 8080 }, initialDelaySeconds: 10, periodSeconds: 20 },
              resources: { requests: { cpu: "50m", memory: "128Mi" } },
            }],
          },
        },
      },
    }, { provider: k8sProvider, parent: this, dependsOn: [code] });

    const svc = new k8s.core.v1.Service(`${name}-svc`, {
      metadata: { name: serviceName, namespace },
      spec: { selector: { app: serviceName }, ports: [{ port: 8080, targetPort: "http", name: "http" }] },
    }, { provider: k8sProvider, parent: this });

    this.serviceName = svc.metadata.name;
    this.serviceUrl = pulumi.interpolate`http://${svc.metadata.name}.${namespace}.svc.cluster.local:8080`;
    this.registerOutputs({ serviceUrl: this.serviceUrl, serviceName: this.serviceName });
  }
}
