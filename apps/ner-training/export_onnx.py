#!/usr/bin/env python3
"""
Export trained NER model to ONNX format for Triton Inference Server deployment.
Uses torch.onnx.export instead of optimum (Python 3.13 compatible).
"""
import argparse
import logging
import json
from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForTokenClassification
import onnx

logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')
logger = logging.getLogger(__name__)


def export_to_onnx(model_path: str, output_path: str, opset_version: int = 14):
    """
    Export HuggingFace model to ONNX format using torch.onnx.export.

    Args:
        model_path: Path to trained model directory
        output_path: Path to save ONNX model
        opset_version: ONNX opset version (14 for Triton compatibility)
    """
    logger.info(f"Loading model from {model_path}")

    # Load tokenizer and model
    tokenizer = AutoTokenizer.from_pretrained(model_path)
    model = AutoModelForTokenClassification.from_pretrained(model_path)
    model.eval()

    logger.info(f"Model config: {model.config.num_labels} labels")
    logger.info(f"Label map: {model.config.id2label}")

    # Create output directory
    output_dir = Path(output_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"Exporting to ONNX (opset {opset_version})...")

    # Create dummy inputs for export (batch_size=1, seq_len=128)
    dummy_input = tokenizer(
        "Sample text for export",
        return_tensors="pt",
        padding="max_length",
        max_length=128,
        truncation=True
    )

    # Define input/output names
    input_names = ["input_ids", "attention_mask"]
    output_names = ["logits"]
    # New exporter prefers dynamic_shapes (used when dynamo=True). Legacy exporter uses dynamic_axes.
    dynamic_shapes = {
        "input_ids": {0: "batch_size", 1: "sequence_length"},
        "attention_mask": {0: "batch_size", 1: "sequence_length"},
    }

    onnx_path = output_dir / "model.onnx"

    # Export to ONNX (try modern exporter with dynamo + dynamic_shapes, fallback to legacy if unsupported)
    with torch.no_grad():
        try:
            torch.onnx.export(
                model,
                (dummy_input["input_ids"], dummy_input["attention_mask"]),
                str(onnx_path),
                input_names=input_names,
                output_names=output_names,
                dynamic_shapes=dynamic_shapes,
                opset_version=opset_version,
                do_constant_folding=True,
                export_params=True,
                dynamo=True,
            )
            logger.info("ONNX export used modern exporter (dynamo=True, dynamic_shapes)")
        except Exception as e:
            logger.warning(f"Modern ONNX export failed (dynamo=True): {e}. Falling back to legacy exporter.")
            torch.onnx.export(
                model,
                (dummy_input["input_ids"], dummy_input["attention_mask"]),
                str(onnx_path),
                input_names=input_names,
                output_names=output_names,
                dynamic_axes={
                    "input_ids": {0: "batch_size", 1: "sequence_length"},
                    "attention_mask": {0: "batch_size", 1: "sequence_length"},
                    "logits": {0: "batch_size", 1: "sequence_length"},
                },
                opset_version=opset_version,
                do_constant_folding=True,
                export_params=True,
            )

    # Save tokenizer and config
    tokenizer.save_pretrained(output_dir)

    # Save label map as separate JSON for Triton
    label_map = {
        "id2label": model.config.id2label,
        "label2id": model.config.label2id
    }
    with open(output_dir / "labels.json", "w") as f:
        json.dump(label_map, f, indent=2)

    # Verify ONNX model
    logger.info(f"Verifying ONNX model at {onnx_path}")
    onnx_model = onnx.load(str(onnx_path))
    onnx.checker.check_model(onnx_model)

    logger.info("✅ ONNX export complete and verified!")
    logger.info(f"Model saved to: {output_dir}")

    # Print model info
    logger.info("\nModel inputs:")
    for input in onnx_model.graph.input:
        logger.info(f"  {input.name}: {input.type}")

    logger.info("\nModel outputs:")
    for output in onnx_model.graph.output:
        logger.info(f"  {output.name}: {output.type}")

    logger.info(f"\nLabel map saved to: {output_dir / 'labels.json'}")

    return str(output_dir)


def main():
    parser = argparse.ArgumentParser(description="Export NER model to ONNX")
    parser.add_argument(
        "--model",
        type=str,
        default="models/ner-distilbert",
        help="Path to trained model directory"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="models/ner-distilbert-onnx",
        help="Output directory for ONNX model"
    )
    parser.add_argument(
        "--opset",
        type=int,
        default=14,
        help="ONNX opset version (default: 14 for Triton)"
    )

    args = parser.parse_args()

    export_to_onnx(args.model, args.output, args.opset)


if __name__ == "__main__":
    main()
