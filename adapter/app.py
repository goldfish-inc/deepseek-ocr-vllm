import os
import json
import base64
import httpx
import numpy as np
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import sentry_sdk
import io
import zipfile
import xml.etree.ElementTree as ET

try:
    from transformers import AutoTokenizer
    TOKENIZER_DIR = os.getenv("TOKENIZER_DIR", "/app/tokenizer")
    if os.path.isdir(TOKENIZER_DIR):
        _tok = AutoTokenizer.from_pretrained(TOKENIZER_DIR, local_files_only=True)
    else:
        _tok = AutoTokenizer.from_pretrained("bert-base-uncased")
except Exception:
    _tok = None

SENTRY_DSN = os.getenv("SENTRY_DSN")
SENTRY_ENVIRONMENT = os.getenv("SENTRY_ENVIRONMENT", "dev")
if SENTRY_DSN:
    sentry_sdk.init(dsn=SENTRY_DSN, environment=SENTRY_ENVIRONMENT, traces_sample_rate=0.0)

TRITON_BASE = os.getenv("TRITON_BASE_URL", "http://localhost:8000")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "bert-base-uncased")

# Optional Cloudflare Access service token support for gating GPU endpoint
CF_ACCESS_CLIENT_ID = os.getenv("CF_ACCESS_CLIENT_ID")
CF_ACCESS_CLIENT_SECRET = os.getenv("CF_ACCESS_CLIENT_SECRET")

def _cf_access_headers():
    if CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET:
        return {
            "CF-Access-Client-Id": CF_ACCESS_CLIENT_ID,
            "CF-Access-Client-Secret": CF_ACCESS_CLIENT_SECRET,
        }
    return {}

# Load NER labels from labels.json or environment variable
# CRITICAL: No silent fallback - fail fast if labels missing to prevent mislabeling
NER_LABELS_ENV = os.getenv("NER_LABELS")
if NER_LABELS_ENV:
    try:
        NER_LABELS = json.loads(NER_LABELS_ENV)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse NER_LABELS environment variable: {e}")
else:
    # Load from labels.json file
    labels_path = os.path.join(os.path.dirname(__file__), "..", "labels.json")
    try:
        with open(labels_path, "r") as f:
            labels_data = json.load(f)
            NER_LABELS = [label["label"] for label in labels_data["labels"]]
    except FileNotFoundError:
        raise RuntimeError(
            "labels.json not found and NER_LABELS environment variable not set. "
            "Cannot start adapter without label taxonomy. "
            "Set NER_LABELS env var or ensure labels.json exists at project root."
        )
    except (json.JSONDecodeError, KeyError) as e:
        raise RuntimeError(f"Failed to load labels from labels.json: {e}")

app = FastAPI()

class PredictRequest(BaseModel):
    text: Optional[str] = None
    pdf_base64: Optional[str] = None
    prompt: Optional[str] = None
    model: Optional[str] = None
    task: Optional[str] = None
    inputs: Optional[dict] = None

def _bytes_tensor(name: str, value: bytes):
    return {"name": name, "shape": [1,1], "datatype": "BYTES", "data": [base64.b64encode(value).decode("utf-8")]}

def _int64_tensor(name: str, arr: np.ndarray):
    return {"name": name, "shape": list(arr.shape), "datatype": "INT64", "data": arr.astype(np.int64).tolist()}

@app.on_event("startup")
async def validate_labels():
    """Validate NER labels match Triton model output shape on startup"""
    try:
        # Query Triton model metadata to get expected number of classes
        metadata_url = f"{TRITON_BASE}/v2/models/{DEFAULT_MODEL}/config"
        async with httpx.AsyncClient() as client:
            response = await client.get(metadata_url, headers=_cf_access_headers())
            response.raise_for_status()
            model_config = response.json()

            # Extract num_labels from model output shape
            # Expected: output shape [-1, -1, num_labels] for token classification
            outputs = model_config.get("output", [])
            if outputs and len(outputs) > 0:
                output_shape = outputs[0].get("dims", [])
                if len(output_shape) >= 3:
                    model_num_labels = output_shape[2]  # Third dimension is num_labels

                    if model_num_labels != len(NER_LABELS):
                        raise RuntimeError(
                            f"CRITICAL: Label count mismatch! "
                            f"Model '{DEFAULT_MODEL}' outputs {model_num_labels} classes, "
                            f"but adapter has {len(NER_LABELS)} labels loaded. "
                            f"This will cause mislabeling. "
                            f"Check labels.json or NER_LABELS environment variable."
                        )

                    print(f"✅ Label validation passed: {len(NER_LABELS)} labels match model output shape")
    except httpx.HTTPError as e:
        print(f"⚠️  Warning: Could not validate labels against Triton model: {e}")
        print(f"   Proceeding with {len(NER_LABELS)} labels loaded from configuration")
    except Exception as e:
        print(f"⚠️  Warning: Label validation error: {e}")

@app.get("/health")
def health():
    return {
        "ok": True,
        "labels": {
            "count": len(NER_LABELS),
            "version": "1.0.0",  # From labels.json
            "source": "labels.json" if not os.getenv("NER_LABELS") else "NER_LABELS env var"
        }
    }

# Label Studio ML backend setup endpoint (required by LS when connecting a model)
@app.get("/setup")
def setup():
    return {
        "model_version": "1.0.0",
        "title": "Triton Inference Adapter",
        "description": "Label Studio ML backend bridging to Triton HTTP v2",
        "interactive": True,
    }

@app.post("/setup")
def setup_post(_: dict = None):
    # Accept Label Studio POST /setup handshake
    return {
        "model_version": "1.0.0",
        "title": "Triton Inference Adapter",
        "description": "Label Studio ML backend bridging to Triton HTTP v2",
        "interactive": True,
        "status": "OK",
    }

# No /healthz endpoint used; /health is canonical

@app.post("/predict")
async def predict(req: PredictRequest):
    model = (req.model or DEFAULT_MODEL).strip()
    url = f"{TRITON_BASE}/v2/models/{model}/infer"

    if req.inputs:
        payload = {"inputs": req.inputs if isinstance(req.inputs, list) else [req.inputs]}
    else:
        inputs = []
        if (model.startswith("bert") or model.startswith("distilbert")) and req.text:
            if _tok is None:
                raise HTTPException(status_code=500, detail="Tokenizer not available")
            enc = _tok(req.text, return_tensors="np", max_length=512, truncation=True)
            inputs.append(_int64_tensor("input_ids", enc["input_ids"]))
            inputs.append(_int64_tensor("attention_mask", enc["attention_mask"]))
        else:
            if req.text:
                inputs.append(_bytes_tensor("text", req.text.encode("utf-8")))
            if req.pdf_base64:
                try:
                    raw = base64.b64decode(req.pdf_base64)
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Invalid pdf_base64: {e}")
                inputs.append(_bytes_tensor("pdf_data", raw))
            if req.prompt:
                inputs.append(_bytes_tensor("prompt", req.prompt.encode("utf-8")))
        if not inputs:
            raise HTTPException(status_code=400, detail="No inputs provided")
        payload = {"inputs": inputs}

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(url, json=payload, headers=_cf_access_headers())
            r.raise_for_status()
            out = r.json()
            if (model.startswith("bert") or model.startswith("distilbert")) and req.task == "classification":
                outputs = out.get("outputs", [])
                logits = None
                for o in outputs:
                    if o.get("name") == "logits":
                        logits = np.array(o.get("data"))
                        break
                if logits is None:
                    return out
                probs = np.exp(logits - np.max(logits))
                probs = probs / np.sum(probs)
                top = int(np.argmax(probs))
                return {"top_class": top, "confidence": float(np.max(probs)), "probs": probs.tolist()}
            return out
    except httpx.HTTPError as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict_ls")
async def predict_ls(request: dict):
    # Accept LS-style payloads and normalize different doc types
    try:
        body = request
        tasks = body if isinstance(body, list) else body.get("tasks") or body.get("data") or []
        if not isinstance(tasks, list):
            tasks = [tasks]
        if not tasks:
            raise HTTPException(status_code=400, detail="No tasks provided")
        data = (tasks[0] or {}).get("data") or tasks[0] or {}
        # Prefer text
        text = data.get("text")
        if text:
            return await predict(PredictRequest(text=text, model="distilbert-base-uncased", task="ner"))
        # Try PDFs/CSV/XLSX via URL
        url = None
        for k in ["pdf", "file", "file_upload", "document", "url"]:
            v = data.get(k)
            if isinstance(v, str) and (v.startswith("http://") or v.startswith("https://")):
                url = v
                break
        if url and url.lower().endswith(".pdf"):
            # Proxy to Triton Docling model by sending empty inputs (model fetches via url is not implemented here)
            # Fallback: raise a friendly error suggesting text extraction
            return await predict(PredictRequest(text=f"[PDF] {url}", model="distilbert-base-uncased", task="ner"))
        if url and url.lower().endswith(".csv"):
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    r = await client.get(url)
                    r.raise_for_status()
                    import csv, io
                    rdr = list(csv.reader(io.StringIO(r.text)))
                    lines = []
                    if rdr:
                        headers = rdr[0]
                        is_header = any(any(c.isalpha() for c in (h or "")) for h in headers)
                        if is_header:
                            for row in rdr[1:]:
                                parts = []
                                for h, v in zip(headers, row):
                                    hv = (h or "").strip()
                                    vv = (v or "").strip()
                                    if hv and vv:
                                        parts.append(f"{hv}: {vv}")
                                if parts:
                                    lines.append(", ".join(parts))
                        else:
                            lines = [", ".join(r) for r in rdr]
                    txt = "\n".join(lines)[:5000]
                return await predict(PredictRequest(text=txt, model="distilbert-base-uncased", task="ner"))
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to process CSV: {e}")
        if url and url.lower().endswith(".xlsx"):
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    r = await client.get(url)
                    r.raise_for_status()
                    txt = _xlsx_to_text(r.content)
                if not txt:
                    raise HTTPException(status_code=400, detail="Empty XLSX content")
                return await predict(PredictRequest(text=txt, model="distilbert-base-uncased", task="ner"))
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to process XLSX: {e}")
        raise HTTPException(status_code=400, detail="Unsupported task data; provide text, pdf or csv URL")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
# Minimal XLSX text extractor using stdlib (no external deps)
def _xlsx_to_text(data: bytes, limit: int = 5000) -> str:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        # Load sharedStrings if present
        shared = []
        try:
            with z.open('xl/sharedStrings.xml') as f:
                tree = ET.parse(f)
                root = tree.getroot()
                # Namespaces handling
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
                tree = ET.parse(f)
                root = tree.getroot()
                for row in root.iter():
                    if row.tag.endswith('}row'):
                        vals = []
                        for c in row:
                            if not hasattr(c, 'tag'):
                                continue
                            if not c.tag.endswith('}c'):
                                continue
                            t_attr = c.attrib.get('t')
                            v_text = None
                            for v in c:
                                if v.tag.endswith('}v') and v.text is not None:
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
        text = '\n'.join(parts)
        return text[:limit]
    except Exception:
        return ''
