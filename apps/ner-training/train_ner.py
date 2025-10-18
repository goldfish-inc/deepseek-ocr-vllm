#!/usr/bin/env python3
"""
Fine-tune DistilBERT for Named Entity Recognition (NER)
9 entity classes: O, VESSEL, HS_CODE, PORT, SPECIES, IMO, FLAG, RISK_LEVEL, DATE

Maritime/Seafood Domain - Recognizes vessel identifiers and fish species

Usage:
    python train_ner.py --data train.jsonl --output models/ner-distilbert
"""
import argparse
import json
import logging
from pathlib import Path
from typing import List, Dict, Any

import torch
from torch.utils.data import Dataset
from transformers import (
    DistilBertForTokenClassification,
    DistilBertTokenizerFast,
    Trainer,
    TrainingArguments,
    DataCollatorForTokenClassification,
)
import numpy as np
from seqeval.metrics import classification_report, f1_score

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Entity labels (must match ls-triton-adapter/main.go)
LABELS = ["O", "VESSEL", "HS_CODE", "PORT", "SPECIES", "IMO", "FLAG", "RISK_LEVEL", "DATE"]
LABEL2ID = {label: i for i, label in enumerate(LABELS)}
ID2LABEL = {i: label for i, label in enumerate(LABELS)}


class NERDataset(Dataset):
    """Token classification dataset for Label Studio export format"""

    def __init__(self, data_path: Path, tokenizer, max_length: int = 512):
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.examples = self._load_data(data_path)

    def _load_data(self, data_path: Path) -> List[Dict]:
        """Load Label Studio annotations in JSONL format"""
        examples = []
        with open(data_path) as f:
            for line in f:
                task = json.loads(line)
                # Extract text and NER annotations
                text = task.get("text", "")
                annotations = task.get("annotations", [])
                if not annotations:
                    continue

                # Convert Label Studio format to token classification
                # Annotations: [{"start": 0, "end": 10, "text": "...", "labels": ["VESSEL"]}]
                entities = []
                for ann in annotations[0].get("result", []):
                    if ann["type"] == "labels":
                        value = ann["value"]
                        entities.append({
                            "start": value["start"],
                            "end": value["end"],
                            "label": value["labels"][0]  # First label
                        })

                examples.append({"text": text, "entities": entities})

        logger.info(f"Loaded {len(examples)} training examples")
        return examples

    def __len__(self):
        return len(self.examples)

    def __getitem__(self, idx):
        example = self.examples[idx]
        text = example["text"]
        entities = example["entities"]

        # Tokenize
        encoding = self.tokenizer(
            text,
            truncation=True,
            max_length=self.max_length,
            padding="max_length",
            return_offsets_mapping=True,
        )

        # Align labels with tokens
        labels = ["O"] * len(encoding["input_ids"])
        offsets = encoding.pop("offset_mapping")

        for entity in entities:
            entity_start = entity["start"]
            entity_end = entity["end"]
            entity_label = entity["label"]

            # Find tokens within entity span
            for token_idx, (token_start, token_end) in enumerate(offsets):
                # Skip special tokens
                if token_start == token_end == 0:
                    continue

                # Token overlaps with entity
                if token_start >= entity_start and token_end <= entity_end:
                    labels[token_idx] = entity_label

        # Convert labels to IDs
        label_ids = [LABEL2ID[label] for label in labels]

        return {
            "input_ids": torch.tensor(encoding["input_ids"]),
            "attention_mask": torch.tensor(encoding["attention_mask"]),
            "labels": torch.tensor(label_ids),
        }


def compute_metrics(pred):
    """Compute seqeval metrics for NER evaluation"""
    predictions, labels = pred
    predictions = np.argmax(predictions, axis=2)

    # Remove padding (-100 labels)
    true_labels = [[ID2LABEL[l] for l in label if l != -100] for label in labels]
    true_predictions = [
        [ID2LABEL[p] for (p, l) in zip(prediction, label) if l != -100]
        for prediction, label in zip(predictions, labels)
    ]

    # Compute F1 score
    f1 = f1_score(true_labels, true_predictions)
    try:
        logger.info(f"\n{classification_report(true_labels, true_predictions)}")
    except ValueError as e:
        # seqeval fails on sparse validation sets (e.g., smoke tests with synthetic data)
        logger.warning(f"Skipping classification report (sparse labels): {e}")

    return {"f1": f1}


def train_ner_model(
    train_path: Path,
    val_path: Path,
    output_dir: Path,
    epochs: int = 3,
    batch_size: int = 16,
    learning_rate: float = 5e-5,
):
    """Fine-tune DistilBERT for NER"""

    logger.info("Loading tokenizer and model...")
    tokenizer = DistilBertTokenizerFast.from_pretrained("distilbert-base-uncased")
    model = DistilBertForTokenClassification.from_pretrained(
        "distilbert-base-uncased",
        num_labels=len(LABELS),
        id2label=ID2LABEL,
        label2id=LABEL2ID,
    )

    logger.info("Loading datasets...")
    train_dataset = NERDataset(train_path, tokenizer)
    val_dataset = NERDataset(val_path, tokenizer) if val_path.exists() else None

    # Training arguments
    training_args = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        learning_rate=learning_rate,
        weight_decay=0.01,
        logging_steps=50,
        eval_strategy="epoch" if val_dataset else "no",
        save_strategy="epoch",
        load_best_model_at_end=True if val_dataset else False,
        metric_for_best_model="f1" if val_dataset else None,
        push_to_hub=False,
        fp16=torch.cuda.is_available(),  # Use mixed precision if GPU available
    )

    # Data collator
    data_collator = DataCollatorForTokenClassification(tokenizer)

    # Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        tokenizer=tokenizer,
        data_collator=data_collator,
        compute_metrics=compute_metrics if val_dataset else None,
    )

    logger.info("Starting training...")
    trainer.train()

    logger.info(f"Saving model to {output_dir}")
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))

    logger.info("✅ Training complete!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train NER model for vessel risk detection")
    parser.add_argument("--train", type=Path, required=True, help="Training data (JSONL)")
    parser.add_argument("--val", type=Path, help="Validation data (JSONL)")
    parser.add_argument("--output", type=Path, default=Path("models/ner-distilbert"))
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=5e-5)

    args = parser.parse_args()

    train_ner_model(
        train_path=args.train,
        val_path=args.val if args.val else Path("nonexistent"),
        output_dir=args.output,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
    )
