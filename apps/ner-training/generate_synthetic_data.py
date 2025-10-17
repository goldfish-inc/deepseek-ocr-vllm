#!/usr/bin/env python3
"""
Generate synthetic NER training data from Label Studio vessel registry records.

Converts structured JSON vessel data into labeled text for Named Entity Recognition.
Outputs Label Studio annotation format with metadata for filtering during retraining.

Requirements:
- kubectl access to cluster
- Label Studio database accessible via port-forward

Usage:
    python generate_synthetic_data.py --output-dir data/
"""

import argparse
import json
import random
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

import yaml


def load_field_mapping(mapping_file: Path) -> Dict:
    """Load field-to-label mapping configuration."""
    with open(mapping_file) as f:
        return yaml.safe_load(f)


def extract_tasks_from_label_studio(input_file: Path = None) -> List[Dict]:
    """
    Extract vessel registry tasks from Label Studio.

    If input_file is provided, reads from that JSON file.
    Otherwise, queries Label Studio database via kubectl.

    Returns list of task dictionaries with structured vessel data.
    """
    if input_file:
        print(f"📁 Loading tasks from {input_file}...")
        with open(input_file) as f:
            tasks = json.load(f)
        print(f"✅ Loaded {len(tasks)} tasks from file")
        return tasks

    print("📡 Connecting to Label Studio database...")

    # Execute query via kubectl exec (with full PATH)
    cmd = [
        "/usr/local/bin/kubectl", "-n", "apps", "exec", "-i",
        "deploy/label-studio-ls-app", "--",
        "python", "manage.py", "shell", "-c",
        "from tasks.models import Task; import json; tasks = Task.objects.filter(project_id=1).values('id', 'data'); print(json.dumps(list(tasks)))"
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            env={
                "KUBECONFIG": str(Path.home() / ".kube" / "k3s-tethys-public.yaml"),
                "PATH": "/usr/local/bin:/usr/bin:/bin"
            }
        )

        tasks = json.loads(result.stdout.strip())
        print(f"✅ Extracted {len(tasks)} tasks from Label Studio")
        return tasks

    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to query Label Studio: {e.stderr}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"❌ Failed to parse task data: {e}", file=sys.stderr)
        sys.exit(1)


def generate_text_from_template(template: str, vessel_data: Dict) -> str:
    """
    Generate natural language text by filling template with vessel data.

    Example:
        Template: "Vessel {Name} with IMO {IMO Number}"
        Data: {"Name": "SOLOMON FISHER", "IMO Number": "8894720"}
        Output: "Vessel SOLOMON FISHER with IMO 8894720"
    """
    text = template

    # Replace placeholders with actual values
    for field, value in vessel_data.items():
        placeholder = "{" + field + "}"
        if placeholder in text and value is not None:
            # Convert numbers to strings
            value_str = str(value) if not isinstance(value, str) else value
            text = text.replace(placeholder, value_str)

    # Remove unfilled placeholders and clean up
    text = re.sub(r'\{[^}]+\}', '', text)
    text = re.sub(r'\s+', ' ', text)  # Collapse multiple spaces
    text = text.strip()

    return text


def calculate_entity_offsets(text: str, vessel_data: Dict, field_mapping: Dict) -> List[Dict]:
    """
    Calculate character offsets for entities in generated text.

    Returns list of entity annotations with start/end positions and labels.
    """
    entities = []
    mapping = field_mapping["field_mapping"]

    for field, label in mapping.items():
        if field in vessel_data and vessel_data[field] is not None:
            value_str = str(vessel_data[field])

            # Find all occurrences of this value in the text
            start = 0
            while True:
                pos = text.find(value_str, start)
                if pos == -1:
                    break

                entities.append({
                    "type": "labels",
                    "value": {
                        "start": pos,
                        "end": pos + len(value_str),
                        "text": value_str,
                        "labels": [label]
                    },
                    "id": f"entity_{len(entities)}",
                    "from_name": "label",
                    "to_name": "text"
                })

                start = pos + len(value_str)

    # Sort entities by start position
    entities.sort(key=lambda e: e["value"]["start"])

    return entities


def create_annotation(
    task_id: int,
    text: str,
    entities: List[Dict],
    generation_time: str
) -> Dict:
    """
    Create Label Studio annotation format with metadata.

    Structure matches Label Studio export format for compatibility with train_ner.py.
    """
    return {
        "id": task_id,
        "text": text,
        "annotations": [{
            "id": f"synth_{task_id}",
            "completed_by": 0,  # Synthetic
            "result": entities,
            "was_cancelled": False,
            "ground_truth": False,
            "created_at": generation_time,
            "updated_at": generation_time
        }],
        "metadata": {
            "source": "synth_vessel_registry",
            "generation_timestamp": generation_time,
            "original_task_id": task_id,
            "synthetic": True
        }
    }


def generate_synthetic_dataset(
    tasks: List[Dict],
    field_mapping: Dict,
    output_dir: Path,
    train_split: float = 0.8
) -> Tuple[int, int]:
    """
    Generate synthetic NER training data from vessel registry tasks.

    Returns (num_train, num_val) examples created.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    train_file = output_dir / "synthetic_train.jsonl"
    val_file = output_dir / "synthetic_val.jsonl"

    templates = field_mapping["text_templates"]
    generation_time = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    train_count = 0
    val_count = 0
    skipped_count = 0

    print(f"\n🔨 Generating synthetic training data...")
    print(f"   Templates: {len(templates)}")
    print(f"   Train/Val split: {train_split:.0%}")

    with open(train_file, 'w') as train_out, open(val_file, 'w') as val_out:
        for task in tasks:
            task_id = task["id"]
            vessel_data = task["data"]

            # Skip tasks missing critical fields
            if not vessel_data.get("Name") or not vessel_data.get("IMO Number"):
                skipped_count += 1
                continue

            # Randomly select template
            template = random.choice(templates)

            # Generate text
            text = generate_text_from_template(template, vessel_data)

            # Skip if template couldn't be filled
            if len(text) < 10:
                skipped_count += 1
                continue

            # Calculate entity offsets
            entities = calculate_entity_offsets(text, vessel_data, field_mapping)

            # Skip if no entities found
            if not entities:
                skipped_count += 1
                continue

            # Create annotation
            annotation = create_annotation(task_id, text, entities, generation_time)

            # Write to train or validation set
            if random.random() < train_split:
                train_out.write(json.dumps(annotation) + "\n")
                train_count += 1
            else:
                val_out.write(json.dumps(annotation) + "\n")
                val_count += 1

    print(f"\n✅ Generated synthetic dataset:")
    print(f"   Training examples: {train_count}")
    print(f"   Validation examples: {val_count}")
    print(f"   Skipped (incomplete): {skipped_count}")
    print(f"\n📁 Output files:")
    print(f"   {train_file}")
    print(f"   {val_file}")

    return train_count, val_count


def main():
    parser = argparse.ArgumentParser(
        description="Generate synthetic NER training data from Label Studio vessel records"
    )
    parser.add_argument(
        "--input",
        type=Path,
        help="Input JSON file with Label Studio tasks (optional, queries database if not provided)"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data"),
        help="Output directory for generated JSONL files (default: data/)"
    )
    parser.add_argument(
        "--mapping",
        type=Path,
        default=Path("field_mapping.yaml"),
        help="Field mapping configuration file (default: field_mapping.yaml)"
    )
    parser.add_argument(
        "--train-split",
        type=float,
        default=0.8,
        help="Train/validation split ratio (default: 0.8)"
    )
    parser.add_argument(
        "--sample",
        type=int,
        help="Generate only N samples for testing"
    )

    args = parser.parse_args()

    # Load configuration
    print("📋 Loading field mapping configuration...")
    field_mapping = load_field_mapping(args.mapping)

    # Extract tasks from Label Studio
    tasks = extract_tasks_from_label_studio(args.input)

    if args.sample:
        tasks = random.sample(tasks, min(args.sample, len(tasks)))
        print(f"🎲 Using {len(tasks)} sample tasks for testing")

    # Generate synthetic dataset
    train_count, val_count = generate_synthetic_dataset(
        tasks,
        field_mapping,
        args.output_dir,
        args.train_split
    )

    # Print summary
    print(f"\n📊 Summary:")
    print(f"   Total synthetic examples: {train_count + val_count}")
    print(f"   Ready for training: python train_ner.py --train {args.output_dir}/synthetic_train.jsonl --val {args.output_dir}/synthetic_val.jsonl")
    print(f"\n⚠️  Note: Synthetic data limitations:")
    print(f"   - Does not include OCR noise, typos, or formatting variations")
    print(f"   - Sentence structures are template-based, not naturalistic")
    print(f"   - Should be supplemented with real annotated documents")


if __name__ == "__main__":
    main()
