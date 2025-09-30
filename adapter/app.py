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
            response = await client.get(metadata_url)
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

@app.get("/healthz")
def healthz():
    return {
        "ok": True,
        "labels": {
            "count": len(NER_LABELS),
            "version": "1.0.0",  # From labels.json
            "source": "labels.json" if not os.getenv("NER_LABELS") else "NER_LABELS env var"
        }
    }

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

