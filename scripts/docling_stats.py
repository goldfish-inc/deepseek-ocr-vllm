#!/usr/bin/env python3
"""
Docling annotations dataset stats.

Reads outbox-sharded JSONL files from a directory and reports:
  - total_records
  - total_boxes (rectanglelabels/polygonlabels)
  - labels distribution (e.g., TABLE/SECTION)
  - percent with pdf_path/pdf_url present in task_data
  - vertical breakdown (if present in payload row)

Usage:
  python scripts/docling_stats.py --in shards_docling --out docling_stats.json
"""
import argparse
import json
from pathlib import Path
from typing import Dict


def iter_lines(path: Path):
    for p in path.glob("*.jsonl"):
        with p.open("r", encoding="utf-8") as f:
            for line in f:
                line=line.strip()
                if line:
                    yield line


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", default="docling_stats.json")
    args = ap.parse_args()

    src = Path(args.src)
    total_records = 0
    total_boxes = 0
    labels: Dict[str,int] = {}
    with_pdf_ref = 0
    verticals: Dict[str,int] = {}

    for line in iter_lines(src):
        try:
            row = json.loads(line)
        except Exception:
            continue
        total_records += 1
        # attempt to read vertical hint from the row (processor stores it in DB, not payload)
        v = (row.get('vertical') or '').strip()
        if v:
            verticals[v] = verticals.get(v,0)+1
        ann = row.get('annotation') or {}
        results = ann.get('result') or []
        for r in results:
            if not isinstance(r, dict):
                continue
            t = str(r.get('type','')).lower()
            if t not in ('rectanglelabels','polygonlabels'):
                continue
            val = r.get('value') or {}
            labs = val.get('labels') or []
            lab = str(labs[0]) if labs else 'UNKNOWN'
            labels[lab] = labels.get(lab,0)+1
            total_boxes += 1
        # check for pdf_path/pdf_url in task_data
        td = row.get('task_data') or {}
        if isinstance(td, dict) and (td.get('pdf_path') or td.get('pdf_url') or td.get('image')):
            with_pdf_ref += 1

    out = {
        'total_records': total_records,
        'total_boxes': total_boxes,
        'labels': dict(sorted(labels.items(), key=lambda kv: (-kv[1], kv[0]))),
        'with_pdf_ref': with_pdf_ref,
        'with_pdf_ref_pct': (with_pdf_ref/total_records*100.0) if total_records else 0.0,
        'verticals': verticals,
    }
    Path(args.dst).write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
