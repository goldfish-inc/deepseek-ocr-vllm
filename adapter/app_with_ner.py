"""
Example integration of NER postprocessor with adapter
This shows how to wire the NER module into the existing adapter
"""

import os
import json
import base64
import httpx
import numpy as np
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Import NER module
from ner import (
    NER_LABELS,
    NER_LABELS_JSON,
    create_postprocessor,
    validate_entity,
    EntityType
)

# Original adapter imports
try:
    from transformers import AutoTokenizer
    TOKENIZER_DIR = os.getenv("TOKENIZER_DIR", "/app/tokenizer")
    if os.path.isdir(TOKENIZER_DIR):
        _tok = AutoTokenizer.from_pretrained(TOKENIZER_DIR, local_files_only=True)
    else:
        _tok = AutoTokenizer.from_pretrained("bert-base-uncased")
except Exception:
    _tok = None

# Initialize NER postprocessor
_ner_processor = create_postprocessor({"confidence_threshold": 0.5})

# Load schema mapping
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "ner", "schema", "ebisu_ner_schema_mapping.json")
with open(SCHEMA_PATH, "r") as f:
    SCHEMA_MAPPING = json.load(f)

# Environment variables
TRITON_BASE = os.getenv("TRITON_BASE_URL", "http://localhost:8000")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "bert-base-uncased")

# Use NER_LABELS from our config
os.environ["NER_LABELS"] = NER_LABELS_JSON

app = FastAPI()


class PredictRequest(BaseModel):
    text: Optional[str] = None
    pdf_base64: Optional[str] = None
    prompt: Optional[str] = None
    model: Optional[str] = None
    task: Optional[str] = None
    inputs: Optional[dict] = None
    enable_ner_postprocessing: Optional[bool] = True


class NEREntity(BaseModel):
    text: str
    label: str
    confidence: float
    start: Optional[int] = None
    end: Optional[int] = None
    database: Optional[Dict[str, Any]] = None
    validated: Optional[bool] = None


class NERResponse(BaseModel):
    entities: List[NEREntity]
    raw_predictions: Optional[List[int]] = None
    tokens: Optional[List[str]] = None
    database_records: Optional[Dict[str, List[Any]]] = None


def _process_ner_output(
    text: str,
    model_output: Dict[str, Any],
    enable_postprocessing: bool = True
) -> NERResponse:
    """
    Process NER model output with schema-aligned postprocessing
    """
    outputs = model_output.get("outputs", [])

    # Extract predictions from model output
    predictions = None
    tokens = None
    confidences = None

    for output in outputs:
        name = output.get("name", "")
        if name == "predictions" or name == "labels":
            predictions = output.get("data", [])
        elif name == "tokens":
            tokens = output.get("data", [])
        elif name == "logits" or name == "confidences":
            confidences = output.get("data", [])

    if not predictions or not tokens:
        # Fallback to pattern-based extraction
        entities = _ner_processor._enhance_entities([], text)
    elif enable_postprocessing:
        # Use full postprocessor
        entities = _ner_processor.process_predictions(
            text, predictions, tokens, confidences
        )
    else:
        # Raw model output without postprocessing
        entities = _ner_processor._tokens_to_entities(
            tokens, predictions, confidences
        )

    # Format for database if requested
    db_records = _ner_processor.format_for_database(entities)

    # Convert to response format
    ner_entities = [
        NEREntity(
            text=e.get("text", ""),
            label=e.get("label", "O"),
            confidence=e.get("confidence", 0.0),
            start=e.get("start"),
            end=e.get("end"),
            database=e.get("database"),
            validated=e.get("validated")
        )
        for e in entities
    ]

    return NERResponse(
        entities=ner_entities,
        raw_predictions=predictions,
        tokens=tokens,
        database_records=db_records if db_records else None
    )


@app.get("/healthz")
def healthz():
    return {
        "ok": True,
        "ner_enabled": True,
        "ner_labels_count": len(NER_LABELS),
        "schema_loaded": SCHEMA_MAPPING is not None
    }


@app.get("/ner/labels")
def get_ner_labels():
    """Get configured NER labels and their database mappings"""
    return {
        "labels": NER_LABELS,
        "total": len(NER_LABELS),
        "entity_types": [e.value for e in EntityType if e.value != "O"],
        "schema_version": SCHEMA_MAPPING.get("schema_version", "unknown")
    }


@app.post("/ner/extract")
async def extract_entities(text: str, enable_postprocessing: bool = True):
    """
    Extract entities from text using pattern matching and validation
    """
    # Use pattern-based extraction
    entities = _ner_processor._enhance_entities([], text)

    if enable_postprocessing:
        # Add database info
        entities = _ner_processor._add_database_info(entities)

    # Format response
    return NERResponse(
        entities=[
            NEREntity(
                text=e.get("text", ""),
                label=e.get("label", "O"),
                confidence=e.get("confidence", 0.0),
                start=e.get("start"),
                end=e.get("end"),
                database=e.get("database"),
                validated=e.get("validated")
            )
            for e in entities
        ]
    )


@app.post("/predict")
async def predict(req: PredictRequest):
    """
    Enhanced predict endpoint with NER postprocessing
    """
    model = (req.model or DEFAULT_MODEL).strip()
    url = f"{TRITON_BASE}/v2/models/{model}/infer"

    # ... [original predict logic] ...

    # Make inference request
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(url, json={"inputs": []})  # Simplified for example
            r.raise_for_status()
            out = r.json()

            # Check if this is NER task
            if req.task == "ner" or "ner" in model.lower():
                # Process with NER postprocessor
                ner_response = _process_ner_output(
                    req.text or "",
                    out,
                    enable_postprocessing=req.enable_ner_postprocessing
                )
                return ner_response.dict()

            # Original response for non-NER tasks
            return out

    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ner/validate")
async def validate_entity(entity_type: str, text: str):
    """
    Validate a specific entity
    """
    try:
        entity_enum = EntityType[entity_type.upper()]
        is_valid = validate_entity(entity_enum, text)

        response = {
            "entity_type": entity_type,
            "text": text,
            "valid": is_valid
        }

        # Add specific validation details
        if entity_type.upper() == "IMO":
            response["checksum_valid"] = is_valid
        elif entity_type.upper() in ["MMSI", "IRCS", "EU_CFR"]:
            response["format_valid"] = is_valid

        return response

    except KeyError:
        raise HTTPException(status_code=400, detail=f"Unknown entity type: {entity_type}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)