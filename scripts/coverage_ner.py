#!/usr/bin/env python3
"""
Compute NER coverage metrics from normalized training data.

Input:
  --data-dir DIR  directory containing *.jsonl rows with {"text", "spans"}
  --labels PATH   labels.json (optional, to include zero-count labels)
  --out PATH      output JSON path (default: ./coverage.json)
  --min-count N   threshold for underrepresentation flag (default 300)

Output JSON:
{
  "total_docs": int,
  "total_spans": int,
  "per_label": { "LABEL": count, ... },
  "underrepresented": ["LABEL", ...]
}
"""
import argparse
import json
from pathlib import Path
from typing import Dict, List


def iter_rows(path: Path):
    for p in path.glob("*.jsonl"):
        with p.open("r", encoding="utf-8") as f:
            for line in f:
                line=line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except Exception:
                    continue


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--labels", required=False)
    ap.add_argument("--out", default="./coverage.json")
    ap.add_argument("--min-count", type=int, default=300)
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    labels: List[str] = []
    if args.labels:
        try:
            labels = json.loads(Path(args.labels).read_text())
        except Exception:
            labels = []

    per_label: Dict[str, int] = {l: 0 for l in labels}
    total_docs = 0
    total_spans = 0

    for row in iter_rows(data_dir):
        total_docs += 1
        spans = row.get("spans") or []
        for s in spans:
            lab = str(s.get("label", "O"))
            if lab not in per_label:
                per_label[lab] = 0
            per_label[lab] += 1
            total_spans += 1

    underrepresented = [lab for lab, cnt in per_label.items() if lab not in ("O",) and cnt < args.min_count]

    out = {
        "total_docs": total_docs,
        "total_spans": total_spans,
        "per_label": per_label,
        "underrepresented": sorted(underrepresented),
        "min_count": args.min_count,
    }

    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
