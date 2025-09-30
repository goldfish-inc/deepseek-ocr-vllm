import os
import json
import base64
import httpx
import numpy as np
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import sentry_sdk

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
NER_LABELS = json.loads(os.getenv("NER_LABELS", "[\"O\",\"VESSEL\",\"HS_CODE\",\"PORT\",\"COMMODITY\",\"IMO\",\"FLAG\",\"RISK_LEVEL\",\"DATE\"]"))

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

@app.get("/healthz")
def healthz():
    return {"ok": True}

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
            r = await client.post(url, json=payload)
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

