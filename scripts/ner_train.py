#!/usr/bin/env python3
"""
Simple NER fine-tuning for DistilBERT using HF Transformers.
Inputs
  --labels LABELS_JSON : JSON array of label strings in order
  --data-dir DIR       : directory of JSONL files with {"text": str, "spans": [{start,end,label}, ...]}
  --out OUT_DIR        : output directory for the trained model
Optional
  --epochs N           : training epochs (default 3)

Note: This is a starter script. Adjust tokenization, chunking, and span alignment for production-grade training.
"""
import argparse
import json
import os
from pathlib import Path
from typing import List, Dict, Any

import datasets as ds
from transformers import AutoTokenizer, DataCollatorForTokenClassification, AutoModelForTokenClassification, TrainingArguments, Trainer


def load_jsonl_dir(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for p in path.glob("*.jsonl"):
        with p.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except Exception:
                    continue
    return rows


def spans_to_bio(text: str, spans: List[Dict[str, Any]], labels: List[str]) -> List[str]:
    # NOTE: This is a naive character-level to token-level mapping handled later.
    # Here we just keep spans for later alignment.
    return []


def align_labels(example, tokenizer, labels: List[str]):
    # Convert character spans to token labels.
    # Expect example["text"], example["spans"] with start/end/label.
    text = example["text"]
    enc = tokenizer(text, truncation=True, return_offsets_mapping=True, max_length=512)
    offsets = enc["offset_mapping"]
    label_ids = [0] * len(offsets)  # default to 'O'

    # Make a map from char position to label index (naive: single label per char range)
    for s in example.get("spans", []) or []:
        start = int(s.get("start", 0))
        end = int(s.get("end", 0))
        lab = str(s.get("label", "O"))
        try:
            lab_idx = labels.index(lab)
        except ValueError:
            lab_idx = 0
        for i, (a, b) in enumerate(offsets):
            if a is None or b is None:
                continue
            if a >= end:
                break
            # Overlap if token span intersects char span
            if a < end and b > start:
                label_ids[i] = lab_idx

    enc["labels"] = label_ids
    enc.pop("offset_mapping", None)
    return enc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", required=True)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=3)
    args = ap.parse_args()

    labels: List[str] = json.loads(Path(args.labels).read_text())
    data = load_jsonl_dir(Path(args.data_dir))
    if not data:
        raise SystemExit("No JSONL data found in --data-dir")

    raw = ds.Dataset.from_list([{ "text": r.get("text", ""), "spans": r.get("spans", []) } for r in data])
    # Train/val split
    dsplit = raw.train_test_split(test_size=0.1, seed=42)

    model_name = "distilbert-base-uncased"
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    def proc(example):
        return align_labels(example, tokenizer, labels)

    columns = ["input_ids", "attention_mask", "labels"]
    train_ds = dsplit["train"].map(proc, remove_columns=dsplit["train"].column_names)
    val_ds = dsplit["test"].map(proc, remove_columns=dsplit["test"].column_names)

    model = AutoModelForTokenClassification.from_pretrained(model_name, num_labels=len(labels))
    collator = DataCollatorForTokenClassification(tokenizer=tokenizer)
    training_args = TrainingArguments(
        output_dir=args.out,
        per_device_train_batch_size=8,
        per_device_eval_batch_size=8,
        learning_rate=5e-5,
        num_train_epochs=args.epochs,
        eval_strategy="epoch",
        save_strategy="epoch",
        logging_steps=50,
        report_to=[],
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        tokenizer=tokenizer,
        data_collator=collator,
    )
    trainer.train()
    os.makedirs(args.out, exist_ok=True)
    trainer.save_model(args.out)
    tokenizer.save_pretrained(args.out)
    print(f"Saved model to {args.out}")


if __name__ == "__main__":
    main()
