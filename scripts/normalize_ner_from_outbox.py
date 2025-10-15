#!/usr/bin/env python3
"""
Normalize outbox-sharded annotation records into NER training format.

Input dir: JSONL files where each line matches annotationRecord schema
  { "task_data": {...}, "annotation": {...}, ... }

Output: JSONL with rows {"text": str, "spans": [{start,end,label}, ...]}
"""
import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable


def iter_records(path: Path) -> Iterable[Dict[str, Any]]:
    for p in path.glob("*.jsonl"):
        try:
            with p.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        yield json.loads(line)
                    except Exception:
                        continue
        except Exception:
            continue


def to_training(rec: Dict[str, Any]) -> Dict[str, Any] | None:
    ann = rec.get("annotation") or {}
    task_data = rec.get("task_data") or {}
    text = ""
    if isinstance(task_data, dict):
        text = task_data.get("text") or ""
    if not text:
        return None

    spans = []
    try:
        results = ann.get("result") or []
        for r in results:
            if not isinstance(r, dict):
                continue
            if r.get("type") not in ("labels", "choices"):
                continue
            val = r.get("value") or {}
            if all(k in val for k in ("start", "end", "labels")):
                label_list = val.get("labels") or []
                if not label_list:
                    continue
                spans.append({
                    "start": int(val.get("start", 0)),
                    "end": int(val.get("end", 0)),
                    "label": str(label_list[0]),
                })
    except Exception:
        pass

    if not spans:
        return None

    return {"text": text, "spans": spans}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True, help="Directory of JSONL shard files")
    ap.add_argument("--out", dest="dst", required=True, help="Output directory for normalized JSONL")
    args = ap.parse_args()

    src = Path(args.src)
    dst = Path(args.dst)
    dst.mkdir(parents=True, exist_ok=True)
    out_path = dst / "ner.jsonl"
    cnt = 0
    with out_path.open("w", encoding="utf-8") as outf:
        for rec in iter_records(src):
            tr = to_training(rec)
            if tr is None:
                continue
            outf.write(json.dumps(tr, ensure_ascii=False) + "\n")
            cnt += 1
    print(f"Wrote {cnt} training rows to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
