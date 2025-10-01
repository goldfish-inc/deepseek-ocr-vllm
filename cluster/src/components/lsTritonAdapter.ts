import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as fs from "fs";
import * as path from "path";
import { toEnvVars, getSentrySettings } from "../sentry-config";

export interface LsTritonAdapterArgs {
    k8sProvider: k8s.Provider;
    namespace?: string;
    serviceName?: string;
    tritonBaseUrl: pulumi.Input<string>; // e.g., https://gpu.boathou.se
    cfAccessClientId?: pulumi.Input<string>;
    cfAccessClientSecret?: pulumi.Input<string>;
}

export class LsTritonAdapter extends pulumi.ComponentResource {
    public readonly serviceUrl: pulumi.Output<string>;
    public readonly serviceName: pulumi.Output<string>;

    constructor(name: string, args: LsTritonAdapterArgs, opts?: pulumi.ComponentResourceOptions) {
        super("oceanid:ml:LsTritonAdapter", name, {}, opts);

        const { k8sProvider, namespace = "apps", serviceName = "ls-triton-adapter", tritonBaseUrl, cfAccessClientId, cfAccessClientSecret } = args;

        // Use existing namespace rather than creating a new one
        // The 'apps' namespace is created by LabelStudio component
        const nsName = pulumi.output(namespace);

        // Try to load adapter sources from the repository (adapter/*). Fallback to built-in app if not found.
        const searchRoots = [
            // Common cases: Pulumi workdir is 'cluster'
            path.resolve(process.cwd(), ".."),
            // Fallback relative to compiled file location
            path.resolve(__dirname, "../../.."),
        ];
        function readFirstExisting(relPath: string): string | undefined {
            for (const root of searchRoots) {
                const p = path.join(root, relPath);
                try {
                    if (fs.existsSync(p)) {
                        return fs.readFileSync(p, "utf8");
                    }
                } catch {
                    // ignore
                }
            }
            return undefined;
        }

        // Prefer the simpler, production-ready adapter/app.py over the experimental app_with_ner.py
        // For reliable pre-labels, default to the built-in app which includes BERT NER decoding.
        // You can opt into repository-provided apps by setting Pulumi config:
        //   pulumi config set oceanid-cluster:useExternalAdapter true
        const cfgPulumi = new pulumi.Config();
        const useExternalAdapter = cfgPulumi.getBoolean("useExternalAdapter") ?? false;
        const externalApp = useExternalAdapter
            ? (readFirstExisting("adapter/app_with_ner.py") || readFirstExisting("adapter/app.py"))
            : undefined;

const appPy = externalApp ?? `
import os
import json
import base64
import httpx
import sentry_sdk
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
import numpy as np
from typing import Optional

try:
    from transformers import AutoTokenizer
    # Try local cache first (if baked into image or mounted)
    TOKENIZER_DIR = os.getenv("TOKENIZER_DIR", "/app/tokenizer")
    if os.path.isdir(TOKENIZER_DIR):
        _tok = AutoTokenizer.from_pretrained(TOKENIZER_DIR, local_files_only=True)
    else:
        _tok = AutoTokenizer.from_pretrained("bert-base-uncased")
    _tok_cache = {"bert-base-uncased": _tok}
    def get_tokenizer(name: str):
        name = (name or "bert-base-uncased").strip()
        if name in _tok_cache:
            return _tok_cache[name]
        try:
            if os.path.isdir(TOKENIZER_DIR) and os.path.basename(TOKENIZER_DIR) == name:
                tok = AutoTokenizer.from_pretrained(TOKENIZER_DIR, local_files_only=True)
            else:
                tok = AutoTokenizer.from_pretrained(name)
            _tok_cache[name] = tok
            return tok
        except Exception:
            return _tok
except Exception:
    _tok = None
    _tok_cache = {}
    def get_tokenizer(name: str):
        if _tok is not None:
            return _tok
        raise RuntimeError("Tokenizer not available")

SENTRY_DSN = os.getenv("SENTRY_DSN")
SENTRY_ENVIRONMENT = os.getenv("SENTRY_ENVIRONMENT", "dev")
if SENTRY_DSN:
    sentry_sdk.init(dsn=SENTRY_DSN, environment=SENTRY_ENVIRONMENT, traces_sample_rate=0.0)

TRITON_BASE = os.getenv("TRITON_BASE_URL")  # e.g., https://gpu.base
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "bert-base-uncased")
# Optional Cloudflare Access service token support
CF_ACCESS_CLIENT_ID = os.getenv("CF_ACCESS_CLIENT_ID")
CF_ACCESS_CLIENT_SECRET = os.getenv("CF_ACCESS_CLIENT_SECRET")
def _cf_access_headers():
    if CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET:
        return {
            "CF-Access-Client-Id": CF_ACCESS_CLIENT_ID,
            "CF-Access-Client-Secret": CF_ACCESS_CLIENT_SECRET,
        }
    return {}
NER_LABELS_ENV = os.getenv("NER_LABELS")
try:
    NER_LABELS = json.loads(NER_LABELS_ENV) if NER_LABELS_ENV else [
        "O","VESSEL","HS_CODE","PORT","COMMODITY","IMO","FLAG","RISK_LEVEL","DATE"
    ]
except Exception:
    NER_LABELS = ["O","VESSEL","HS_CODE","PORT","COMMODITY","IMO","FLAG","RISK_LEVEL","DATE"]

app = FastAPI()

class PredictRequest(BaseModel):
    text: Optional[str] = None
    pdf_base64: Optional[str] = None
    pdf_url: Optional[str] = None
    prompt: Optional[str] = None
    model: Optional[str] = None
    task: Optional[str] = None  # "classification" | "ner"
    # Optional raw Triton inputs pass-through
    inputs: Optional[dict] = None

@app.get("/health")
async def health():
    return {"ok": True}

@app.get("/setup")
async def setup():
    return {
        "model_version": "1.0.0",
        "title": "Triton Inference Adapter",
        "description": "Label Studio ML backend bridging to Triton HTTP v2",
        "interactive": True,
    }

@app.post("/setup")
async def setup_post():
    return {
        "model_version": "1.0.0",
        "title": "Triton Inference Adapter",
        "description": "Label Studio ML backend bridging to Triton HTTP v2",
        "interactive": True,
        "status": "OK",
    }

def _bytes_tensor(name: str, value: bytes):
    # Triton HTTP v2 bytes: base64 of raw bytes, dtype BYTES
    return {"name": name, "shape": [1,1], "datatype": "BYTES", "data": [base64.b64encode(value).decode("utf-8")]}

def _int64_tensor(name: str, arr: np.ndarray):
    shape = list(arr.shape)
    return {"name": name, "shape": shape, "datatype": "INT64", "data": arr.astype(np.int64).tolist()}

@app.post("/predict")
async def predict(req: PredictRequest):
    model = (req.model or DEFAULT_MODEL).strip()
    url = f"{TRITON_BASE}/v2/models/{model}/infer"

    # Pass-through mode if user supplies raw inputs (advanced)
    if req.inputs:
        payload = {"inputs": req.inputs if isinstance(req.inputs, list) else [req.inputs]}
    else:
        # Convenience mode
        inputs = []
        is_bert_like = model.startswith("bert") or model.startswith("distilbert")
        if is_bert_like and req.text:
            try:
                tok = get_tokenizer(model)
            except Exception:
                raise HTTPException(status_code=500, detail="Tokenizer not available")
            enc = tok(req.text, return_tensors="np", max_length=512, truncation=True)
            input_ids = enc["input_ids"]
            attention_mask = enc["attention_mask"]
            inputs.append(_int64_tensor("input_ids", input_ids))
            inputs.append(_int64_tensor("attention_mask", attention_mask))
        else:
            if req.text:
                inputs.append(_bytes_tensor("text", req.text.encode("utf-8")))
            # Prefer explicit base64 if provided
            if req.pdf_base64:
                try:
                    raw = base64.b64decode(req.pdf_base64)
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Invalid pdf_base64: {e}")
                inputs.append(_bytes_tensor("pdf_data", raw))
            # Fallback to fetching via URL if provided
            elif req.pdf_url:
                try:
                    async with httpx.AsyncClient(timeout=30.0, verify=True) as client:
                        r = await client.get(req.pdf_url)
                        r.raise_for_status()
                        inputs.append(_bytes_tensor("pdf_data", r.content))
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Failed to fetch pdf_url: {e}")
            if req.prompt:
                inputs.append(_bytes_tensor("prompt", req.prompt.encode("utf-8")))
        if not inputs:
            raise HTTPException(status_code=400, detail="No inputs provided")
        payload = {"inputs": inputs}

    try:
        async with httpx.AsyncClient(timeout=60.0, verify=True) as client:
            r = await client.post(url, json=payload, headers=_cf_access_headers())
            if r.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Triton error: {r.status_code} {r.text}")
            out = r.json()
            # Optional postprocessing for BERT-family classification
            is_bert_like = model.startswith("bert") or model.startswith("distilbert")
            if is_bert_like and req.task == "classification":
                try:
                    outputs = out.get("outputs", [])
                    logits = None
                    for o in outputs:
                        if o.get("name") == "logits":
                            logits = np.array(o.get("data"))
                            break
                    if logits is None:
                        return out
                    # Softmax
                    probs = np.exp(logits - np.max(logits))
                    probs = probs / np.sum(probs)
                    top = int(np.argmax(probs))
                    return {"top_class": top, "confidence": float(np.max(probs)), "probs": probs.tolist()}
                except Exception:
                    # Fallback to raw
                    return out
            if is_bert_like and req.task == "ner":
                try:
                    outputs = out.get("outputs", [])
                    logits = None
                    for o in outputs:
                        if o.get("name") == "logits":
                            logits = np.array(o.get("data"))
                            break
                    if logits is None:
                        return out
                    # logits shape: [batch, seq_len, num_labels]
                    probs = np.exp(logits - np.max(logits, axis=-1, keepdims=True))
                    probs = probs / np.sum(probs, axis=-1, keepdims=True)
                    pred = np.argmax(probs, axis=-1)[0]
                    # Token offsets for grouping entities
                    if req.text is None:
                        return {"entities": []}
                    try:
                        tok = get_tokenizer(model)
                    except Exception:
                        return {"entities": []}
                    enc_offsets = tok(req.text, return_offsets_mapping=True)
                    offsets = enc_offsets["offset_mapping"]
                    entities = []
                    current = None
                    for (start, end), label_idx in zip(offsets, pred.tolist()):
                        if end == 0 and start == 0:
                            # Special tokens like [CLS]/[SEP]
                            continue
                        label_name = NER_LABELS[label_idx] if label_idx < len(NER_LABELS) else f"LABEL_{label_idx}"
                        if label_name == "O":
                            if current:
                                entities.append(current)
                                current = None
                            continue
                        # token text
                        token_text = req.text[start:end]
                        score = float(np.max(probs[0, offsets.index((start, end))])) if isinstance(offsets, list) else 1.0
                        if current and current["label"] == label_name and start == current["end"]:
                            # contiguous
                            current["text"] += token_text
                            current["end"] = end
                            current["score"] = max(current["score"], score)
                        else:
                            if current:
                                entities.append(current)
                            current = {"label": label_name, "text": token_text, "start": start, "end": end, "score": score}
                    if current:
                        entities.append(current)
                    return {"entities": entities}
                except Exception:
                    return out
            return out
    except HTTPException:
        raise
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=500, detail=str(e))

# Label Studio task-aware endpoint: fetch PDF/URL from task payload
@app.post("/predict_ls")
async def predict_ls(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    tasks = body if isinstance(body, list) else body.get("tasks") or body.get("data") or []
    if not isinstance(tasks, list):
        tasks = [tasks]
    if not tasks:
        raise HTTPException(status_code=400, detail="No tasks provided")

    # Try first task
    t = tasks[0] or {}
    data = t.get("data", t)
    pdf_url = None
    csv_url = None
    text = None
    if isinstance(data, dict):
        text = data.get("text")
        for k in ["pdf", "file", "file_upload", "document", "url"]:
            v = data.get(k)
            if isinstance(v, str) and (v.startswith("http://") or v.startswith("https://")):
                lv = v.lower()
                if lv.endswith(".pdf"):
                    pdf_url = v
                    break
                if lv.endswith(".csv"):
                    csv_url = v
                    break
        if not pdf_url:
            for v in data.values():
                if isinstance(v, str) and (v.startswith("http://") or v.startswith("https://")) and ".pdf" in v.lower():
                    pdf_url = v
                    break

    if pdf_url:
        return await predict(PredictRequest(pdf_url=pdf_url, model="docling_granite_python"))
    # Try Excel (.xlsx)
    xlsx_url = None
    for k in ["excel", "xlsx", "file", "file_upload", "document", "url"]:
        v = data.get(k)
        if isinstance(v, str) and (v.startswith("http://") or v.startswith("https://")) and v.lower().endswith(".xlsx"):
            xlsx_url = v
            break
    if xlsx_url:
        try:
            import httpx, io, zipfile
            import xml.etree.ElementTree as ET
            async with httpx.AsyncClient(timeout=20.0, verify=True) as client:
                r = await client.get(xlsx_url)
                r.raise_for_status()
                z = zipfile.ZipFile(io.BytesIO(r.content))
                shared = []
                try:
                    with z.open('xl/sharedStrings.xml') as f:
                        root = ET.parse(f).getroot()
                        for si in root.iter():
                            if si.tag.endswith('}si'):
                                texts = []
                                for t in si.iter():
                                    if t.tag.endswith('}t') and t.text:
                                        texts.append(t.text)
                                shared.append(''.join(texts))
                except KeyError:
                    shared = []
                parts = []
                for name in z.namelist():
                    if not name.startswith('xl/worksheets/sheet') or not name.endswith('.xml'):
                        continue
                    with z.open(name) as f:
                        root = ET.parse(f).getroot()
                        for row in root.iter():
                            if row.tag.endswith('}row'):
                                vals = []
                                for c in row:
                                    if not hasattr(c, 'tag') or not c.tag.endswith('}c'):
                                        continue
                                    t_attr = c.attrib.get('t')
                                    v_text = None
                                    for v in c:
                                        if getattr(v, 'tag', '').endswith('}v') and v.text is not None:
                                            v_text = v.text
                                            break
                                    if v_text is None:
                                        continue
                                    if t_attr == 's':
                                        try:
                                            idx = int(v_text)
                                            v_text = shared[idx] if 0 <= idx < len(shared) else v_text
                                        except Exception:
                                            pass
                                    vals.append(str(v_text))
                                if vals:
                                    parts.append(', '.join(vals))
                xl_text = "\n".join(parts)[:5000]
            return await predict(PredictRequest(text=xl_text, model="distilbert-base-uncased", task="ner"))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to process XLSX: {e}")
    if csv_url:
        try:
            import httpx, csv, io
            async with httpx.AsyncClient(timeout=20.0, verify=True) as client:
                r = await client.get(csv_url)
                r.raise_for_status()
                content = r.text
            reader = csv.reader(io.StringIO(content))
            rows = list(reader)
            lines: list[str] = []
            if rows:
                headers = rows[0]
                # Heuristic: header row if any cell is non-numeric or contains letters
                is_header = any(any(c.isalpha() for c in (h or "")) for h in headers)
                if is_header:
                    for row in rows[1:]:
                        parts = []
                        for h, v in zip(headers, row):
                            hv = (h or "").strip()
                            vv = (v or "").strip()
                            if hv and vv:
                                parts.append(f"{hv}: {vv}")
                        if parts:
                            lines.append(", ".join(parts))
                else:
                    lines = [", ".join(r) for r in rows]
            csv_text = "\n".join(lines)[:5000]
            return await predict(PredictRequest(text=csv_text, model="distilbert-base-uncased", task="ner"))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to process CSV: {e}")
    if text:
        return await predict(PredictRequest(text=text, model="distilbert-base-uncased", task="ner"))

    raise HTTPException(status_code=400, detail="No PDF URL or text found in task data")
`;

        const externalReq = readFirstExisting("adapter/requirements.txt");
        const requirements = externalReq ?? `fastapi==0.114.0\nuvicorn==0.30.6\nhttpx==0.27.2\nsentry-sdk==2.14.0\npydantic==2.9.2\ntransformers==4.44.2\nnumpy==2.1.1\n`;

        // Optional: include NER module and schema files if present
        const nerInit = readFirstExisting("adapter/ner/__init__.py");
        const nerConfig = readFirstExisting("adapter/ner/ner_config.py");
        const nerPost = readFirstExisting("adapter/ner/ner_postprocessor.py");
        const nerSchema = readFirstExisting("adapter/ner/schema/ebisu_ner_schema_mapping.json");

        // ConfigMap data keys must be flat; map to nested paths via items in the volume spec
        const cfgData: Record<string, string> = {
            "app.py": appPy,
            "requirements.txt": requirements,
        };
        if (nerInit) cfgData["ner__init__.py"] = nerInit;
        if (nerConfig) cfgData["ner_ner_config.py"] = nerConfig;
        if (nerPost) cfgData["ner_ner_postprocessor.py"] = nerPost;
        if (nerSchema) cfgData["ner_schema_ebisu_ner_schema_mapping.json"] = nerSchema;

        const cfg = new k8s.core.v1.ConfigMap(`${name}-code`, {
            metadata: { name: `${serviceName}-code`, namespace },
            data: cfgData,
        }, { provider: k8sProvider, parent: this });

        const sentry = getSentrySettings();
        // reuse cfgPulumi above
        const defaultLabels = [
            "O","VESSEL","HS_CODE","PORT","COMMODITY","IMO","FLAG","RISK_LEVEL","DATE"
        ];
        const nerLabelsFromConfig = cfgPulumi.getSecret("nerLabels");

        // Prefer K8s Secret for NER_LABELS sourced from ESC; fallback to config/default env
        let nerLabelsSecret: k8s.core.v1.Secret | undefined;
        if (nerLabelsFromConfig) {
            nerLabelsSecret = new k8s.core.v1.Secret(`${name}-ner-labels`, {
                metadata: { name: `${serviceName}-ner-labels`, namespace },
                stringData: {
                    "ner-labels": nerLabelsFromConfig,
                },
            }, { provider: k8sProvider, parent: this });
        }

        const envBase = {
            TRITON_BASE_URL: tritonBaseUrl,
            DEFAULT_MODEL: "distilbert-base-uncased",
            ...toEnvVars(sentry),
        } as Record<string, pulumi.Input<string>>;

        // Optional: allow gating gpu.<base> behind Cloudflare Access with service tokens
        const cfIdFromCfg = cfgPulumi.getSecret("cfAccessClientId");
        const cfSecretFromCfg = cfgPulumi.getSecret("cfAccessClientSecret");
        const finalCfId = (cfAccessClientId as any) || (cfIdFromCfg as any);
        const finalCfSecret = (cfAccessClientSecret as any) || (cfSecretFromCfg as any);
        if (finalCfId && finalCfSecret) {
            envBase["CF_ACCESS_CLIENT_ID"] = finalCfId;
            envBase["CF_ACCESS_CLIENT_SECRET"] = finalCfSecret;
        }

        // If Secret not provided, fall back to config/default
        if (!nerLabelsSecret) {
            envBase["NER_LABELS"] = (cfgPulumi.get("nerLabels") || JSON.stringify(defaultLabels));
        }

        const deploy = new k8s.apps.v1.Deployment(`${name}-deploy`, {
            metadata: { name: serviceName, namespace },
            spec: {
                replicas: 1,
                selector: { matchLabels: { app: serviceName } },
                template: {
                    metadata: { labels: { app: serviceName } },
                    spec: {
                        volumes: [{
                            name: "code",
                            configMap: {
                                name: cfg.metadata.name,
                                items: [
                                    { key: "app.py", path: "app.py" },
                                    { key: "requirements.txt", path: "requirements.txt" },
                                    ...(nerInit ? [{ key: "ner__init__.py", path: "ner/__init__.py" }] : []),
                                    ...(nerConfig ? [{ key: "ner_ner_config.py", path: "ner/ner_config.py" }] : []),
                                    ...(nerPost ? [{ key: "ner_ner_postprocessor.py", path: "ner/ner_postprocessor.py" }] : []),
                                    ...(nerSchema ? [{ key: "ner_schema_ebisu_ner_schema_mapping.json", path: "ner/schema/ebisu_ner_schema_mapping.json" }] : []),
                                ],
                            },
                        }],
                        containers: [{
                            name: "adapter",
                            image: "python:3.11-slim",
                            workingDir: "/app",
                            env: Object.entries(envBase).map(([name, value]) => ({ name, value })),
                            envFrom: [],
                            volumeMounts: [{ name: "code", mountPath: "/app" }],
                            command: ["bash", "-lc"],
                            args: [
                                "python -m venv /venv && /venv/bin/pip install --no-cache-dir -r requirements.txt && exec /venv/bin/uvicorn app:app --host 0.0.0.0 --port 9090"
                            ],
                            ports: [{ containerPort: 9090, name: "http" }],
                            readinessProbe: { httpGet: { path: "/health", port: 9090 }, initialDelaySeconds: 5, periodSeconds: 10 },
                            livenessProbe: { httpGet: { path: "/health", port: 9090 }, initialDelaySeconds: 10, periodSeconds: 20 },
                            resources: { requests: { cpu: "100m", memory: "128Mi" } },
                        }],
                    },
                },
            },
        }, { provider: k8sProvider, parent: this, dependsOn: [cfg] });

        // Patch env to reference Secret if present (valueFrom)
        if (nerLabelsSecret) {
            deploy.spec.apply(spec => {
                if (!spec) return spec;
                const c = spec.template?.spec?.containers?.[0];
                if (c) {
                    // Add NER_LABELS from secret
                    const env = c.env ?? [];
                    env.push({
                        name: "NER_LABELS",
                        valueFrom: {
                            secretKeyRef: { name: nerLabelsSecret!.metadata.name, key: "ner-labels" },
                        },
                    } as any);
                    c.env = env as any;
                }
                return spec;
            });
        }

        const svc = new k8s.core.v1.Service(`${name}-svc`, {
            metadata: { name: serviceName, namespace },
            spec: {
                selector: { app: serviceName },
                ports: [{ port: 9090, targetPort: "http", name: "http" }],
            },
        }, { provider: k8sProvider, parent: this });

        this.serviceName = svc.metadata.name;
        this.serviceUrl = pulumi.interpolate`http://${svc.metadata.name}.${namespace}.svc.cluster.local:9090`;
        this.registerOutputs({ serviceUrl: this.serviceUrl, serviceName: this.serviceName });
    }
}
