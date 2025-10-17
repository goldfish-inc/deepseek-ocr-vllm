#!/usr/bin/env python3
"""
Test NER model inference via Triton
"""
import argparse
import json
import requests
import numpy as np
from transformers import DistilBertTokenizerFast

# Entity labels (Maritime/Seafood Domain)
LABELS = ["O", "VESSEL", "HS_CODE", "PORT", "SPECIES", "IMO", "FLAG", "RISK_LEVEL", "DATE"]


def test_triton_inference(triton_url: str, model_name: str, text: str):
    """Send inference request to Triton and decode results"""

    print(f"Testing Triton NER inference")
    print(f"URL: {triton_url}")
    print(f"Model: {model_name}")
    print(f"Text: {text}")
    print()

    # Tokenize
    tokenizer = DistilBertTokenizerFast.from_pretrained("distilbert-base-uncased")
    encoding = tokenizer(
        text,
        return_tensors="np",
        max_length=512,
        padding="max_length",
        truncation=True,
        return_offsets_mapping=True,
    )

    input_ids = encoding["input_ids"].astype(np.int64)
    attention_mask = encoding["attention_mask"].astype(np.int64)
    offsets = encoding["offset_mapping"][0]
    tokens = tokenizer.convert_ids_to_tokens(input_ids[0])

    # Build Triton request
    request_body = {
        "inputs": [
            {
                "name": "input_ids",
                "shape": list(input_ids.shape),
                "datatype": "INT64",
                "data": input_ids.flatten().tolist(),
            },
            {
                "name": "attention_mask",
                "shape": list(attention_mask.shape),
                "datatype": "INT64",
                "data": attention_mask.flatten().tolist(),
            },
        ]
    }

    # Send request
    url = f"{triton_url}/v2/models/{model_name}/infer"
    print(f"Sending request to {url}...")
    response = requests.post(url, json=request_body)

    if response.status_code != 200:
        print(f"❌ Request failed: {response.status_code}")
        print(response.text)
        return

    result = response.json()
    logits_flat = result["outputs"][0]["data"]
    shape = result["outputs"][0]["shape"]

    print(f"✅ Response received")
    print(f"Logits shape: {shape}")
    print()

    # Reshape logits
    batch_size, seq_len, num_labels = shape
    logits = np.array(logits_flat).reshape(shape)

    # Get predictions (argmax)
    predictions = np.argmax(logits[0], axis=1)

    # Decode entities
    print("Token predictions:")
    print("-" * 80)
    entities = []
    current_entity = None

    for i, (token, pred_id, offset) in enumerate(zip(tokens, predictions, offsets)):
        if token in ["[CLS]", "[SEP]", "[PAD]"]:
            continue

        pred_label = LABELS[pred_id]
        start, end = offset

        print(f"{i:3d}  {token:15s}  {pred_label:12s}  offset: [{start:3d}, {end:3d}]")

        # Merge consecutive same-label tokens
        if pred_label != "O":
            if current_entity and current_entity["label"] == pred_label:
                # Extend entity
                current_entity["end"] = end
            else:
                # Start new entity
                if current_entity:
                    entities.append(current_entity)
                current_entity = {
                    "label": pred_label,
                    "start": start,
                    "end": end,
                }
        else:
            if current_entity:
                entities.append(current_entity)
                current_entity = None

    if current_entity:
        entities.append(current_entity)

    print()
    print("Extracted entities:")
    print("-" * 80)
    for entity in entities:
        entity_text = text[entity["start"]:entity["end"]]
        print(f"{entity['label']:12s}  [{entity['start']:3d}, {entity['end']:3d}]  {entity_text!r}")

    if not entities:
        print("(No entities found)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test Triton NER inference")
    parser.add_argument("--url", default="http://192.168.2.110:8000", help="Triton URL")
    parser.add_argument("--model", default="ner-distilbert", help="Model name")
    parser.add_argument(
        "--text",
        default="VESSEL: Arctic Explorer IMO: 1234567 FLAG: Norway PORT: Bergen",
        help="Text to analyze",
    )

    args = parser.parse_args()
    test_triton_inference(args.url, args.model, args.text)
