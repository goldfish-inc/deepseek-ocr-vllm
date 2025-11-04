#!/usr/bin/env python3
"""
Spark PDF Extraction (JSON, no DB, no fallbacks)

Usage (run from repo root):

  spark-submit \
    --master spark://your-master:7077 \
    --deploy-mode client \
    --py-files scripts/pdf_extract.py \
    apps/spark-jobs/pdf-extract/job.py \
    --input-dir /data/pdfs \
    --out-dir /data/extractions \
    --partitions 64 \
    --include-layout \
    --strict --min-doc-chars 50 --min-pages-with-text 1

Notes
- Ensure pdfplumber is installed on executors (baked into image or via environment).
- Output directory must be writable and visible from executors (e.g., shared NFS, s3a:// with appropriate Hadoop config).
- No OCR fallback here by design. Strict mode fails the job if text isn’t present by thresholds.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Iterable, List, Tuple

from pyspark.sql import SparkSession  # type: ignore

try:
    # Provided via --py-files scripts/pdf_extract.py
from pdf_extract import extract_pdf_to_json, compute_text_metrics  # type: ignore
except Exception:
    # Fallback to package path when running in-process with PYTHONPATH=.
    from scripts.pdf_extract import extract_pdf_to_json, compute_text_metrics  # type: ignore


def list_pdfs(root: Path) -> List[str]:
    out: List[str] = []
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if f.lower().endswith(".pdf"):
                out.append(str(Path(dirpath) / f))
    return out


def process_one(
    path: str,
    input_root: str,
    out_root: str,
    include_layout: bool,
    strict: bool,
    min_chars: int,
    min_pages: int,
    engine: str,
    ocr_url: str,
    ocr_headers: Optional[Dict[str, str]],
) -> Tuple[str, str, int, int, int, bool, str]:
    """Process a single PDF path.

    Returns tuple: (pdf, json, page_count, total_chars, pages_with_text, failed, error)
    """
    rel = os.path.relpath(path, start=input_root)
    out_path = os.path.join(out_root, os.path.splitext(rel)[0] + ".json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    error = ""
    try:
        doc = extract_pdf_to_json(
            path,
            include_layout=include_layout,
            engine=engine,
            ocr_url=ocr_url,
            ocr_headers=ocr_headers,
        )
        metrics = compute_text_metrics(doc)
        failed = False
        if strict:
            mc = max(1, int(min_chars))
            mp = max(1, int(min_pages))
            failed = not (metrics["total_chars"] >= mc and metrics["pages_with_text"] >= mp)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)
        return (
            path,
            out_path,
            int(doc.get("page_count", 0)),
            int(metrics["total_chars"]),
            int(metrics["pages_with_text"]),
            bool(failed),
            error,
        )
    except Exception as e:
        error = str(e)
        return (path, out_path, 0, 0, 0, True, error)


def main():
    ap = argparse.ArgumentParser(description="Spark batch PDF extraction to JSON")
    ap.add_argument("--input-dir", required=True, help="Directory of PDFs (recursive)")
    ap.add_argument("--out-dir", required=True, help="Directory to write JSON outputs (mirrors structure) + manifest.jsonl")
    ap.add_argument("--partitions", type=int, default=32, help="Parallelism level")
    ap.add_argument("--include-layout", action="store_true", help="Include word-level bounding boxes per page")
    ap.add_argument("--engine", choices=["deepseek", "pdfplumber"], default="deepseek", help="Extraction engine (default: deepseek)")
    ap.add_argument("--ocr-url", help="DeepSeek OCR endpoint. Accepts comma-separated list for multiple workers (required when engine=deepseek)")
    ap.add_argument("--ocr-header", action="append", default=[], help="Additional header for OCR request, repeatable (e.g., 'Authorization: Bearer TOKEN')")
    ap.add_argument("--strict", action="store_true", help="Fail if a file does not meet text thresholds")
    ap.add_argument("--min-doc-chars", type=int, default=0, help="Minimum total characters per document (strict mode)")
    ap.add_argument("--min-pages-with-text", type=int, default=0, help="Minimum pages with text per document (strict mode)")
    args = ap.parse_args()

    input_root = str(Path(args.input_dir).resolve())
    out_root = str(Path(args.out_dir).resolve())
    Path(out_root).mkdir(parents=True, exist_ok=True)

    spark = SparkSession.builder.appName("pdf-extract-json").getOrCreate()
    sc = spark.sparkContext

    files = list_pdfs(Path(input_root))
    if not files:
        print(f"No PDFs found under {input_root}", file=sys.stderr)
        spark.stop()
        sys.exit(1)

    rdd = sc.parallelize(files, numSlices=int(args.partitions))
    # Capture args for executors
    include_layout = bool(args.include_layout)
    strict = bool(args.strict)
    min_chars = int(args.min_doc_chars)
    min_pages = int(args.min_pages_with_text)
    engine = str(args.engine)
    # Support comma-separated list of endpoints; pick per-file deterministically
    ocr_urls = [u.strip() for u in str(args.ocr_url or "").split(",") if u.strip()]
    headers = {}
    for h in (args.ocr_header or []):
        if ":" in h:
            k, v = h.split(":", 1)
            headers[k.strip()] = v.strip()

    def _map(path: str):
        chosen = ""
        if ocr_urls:
            # Deterministic selection by path for stable distribution
            idx = abs(hash(path)) % len(ocr_urls)
            chosen = ocr_urls[idx]
        return process_one(path, input_root, out_root, include_layout, strict, min_chars, min_pages, engine, chosen, headers)

    results = rdd.map(_map).collect()

    # Write manifest on driver
    manifest_path = os.path.join(out_root, "manifest.jsonl")
    failures = 0
    with open(manifest_path, "w", encoding="utf-8") as mf:
        for rec in results:
            pdf, js, pc, chars, pwt, failed, error = rec
            if failed:
                failures += 1
            mf.write(json.dumps({
                "pdf": pdf,
                "json": js,
                "page_count": pc,
                "total_chars": chars,
                "pages_with_text": pwt,
                "failed": bool(failed),
                "error": error,
            }) + "\n")

    print(f"Processed {len(results)} PDFs → {manifest_path}")
    spark.stop()
    if strict and failures > 0:
        print(f"Strict mode: {failures} file(s) failed thresholds", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
