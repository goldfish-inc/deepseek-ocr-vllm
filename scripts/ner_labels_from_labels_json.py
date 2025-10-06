#!/usr/bin/env python3
"""
Emit the NER label names array from labels.json in the correct order.

Usage
  python scripts/ner_labels_from_labels_json.py > ner_labels.json
  pulumi -C cluster config set oceanid-cluster:nerLabels "$(cat ner_labels.json)" --secret

Options
  -i / --input   Path to labels.json (default: ./labels.json)
  -m / --min     Output as compact JSON (default)
  -p / --pretty  Output pretty-printed JSON
"""

import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("-i", "--input", default="labels.json", help="Path to labels.json")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("-m", "--min", action="store_true", help="Compact JSON output (default)")
    group.add_argument("-p", "--pretty", action="store_true", help="Pretty JSON output")
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        print(f"labels.json not found at: {path}", file=sys.stderr)
        sys.exit(1)

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    labels = data.get("labels", [])
    # Preserve explicit index order if present, else current order
    if labels and isinstance(labels[0], dict) and "index" in labels[0]:
        labels_sorted = sorted(labels, key=lambda x: x.get("index", 0))
    else:
        labels_sorted = labels

    label_names = [l["label"] if isinstance(l, dict) else str(l) for l in labels_sorted]

    if args.pretty:
        print(json.dumps(label_names, indent=2, ensure_ascii=False))
    else:
        print(json.dumps(label_names, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    main()
