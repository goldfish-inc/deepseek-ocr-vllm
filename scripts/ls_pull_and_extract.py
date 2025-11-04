#!/usr/bin/env python3
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional

import requests  # type: ignore
from tqdm import tqdm  # type: ignore

try:
    from label_studio_sdk import Client  # type: ignore
except Exception as e:
    print("label-studio-sdk is required. Install with: pip install -r scripts/requirements-labelstudio.txt", file=sys.stderr)
    raise

from scripts.pdf_extract import extract_pdf_to_json, compute_text_metrics


def download_url(url: str, dest: Path, api_key: Optional[str] = None) -> None:
    headers = {}
    if api_key and (url.startswith("/data/") or url.startswith("data/")):
        # Prepend host later if needed; caller ensures absolute URL
        headers["Authorization"] = f"Token {api_key}"
    with requests.get(url, headers=headers, stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        with open(dest, "wb") as f, tqdm(total=total, unit="B", unit_scale=True, desc=str(dest.name)) as pbar:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    pbar.update(len(chunk))


def main():
    ap = argparse.ArgumentParser(description="Pull tasks from Label Studio and extract PDFs to JSON")
    ap.add_argument("--ls-url", required=True, help="Label Studio base URL, e.g. https://ls.example.com")
    ap.add_argument("--api-key", required=True, help="Label Studio API key")
    ap.add_argument("--project-id", type=int, required=True, help="Label Studio project ID")
    ap.add_argument("--out-dir", required=True, help="Directory to write JSON outputs and manifest.jsonl")
    ap.add_argument("--data-key", default="pdf", help="Key in task data that points to the PDF (default: pdf)")
    ap.add_argument("--include-layout", action="store_true", help="Include word-level bounding boxes per page")
    ap.add_argument("--engine", choices=["deepseek", "pdfplumber"], default="deepseek", help="Extraction engine (default: deepseek)")
    ap.add_argument("--ocr-url", help="DeepSeek OCR endpoint (required for deepseek engine)")
    ap.add_argument("--ocr-header", action="append", default=[], help="Additional header for OCR request, repeatable (e.g., 'Authorization: Bearer TOKEN')")
    ap.add_argument("--strict", action="store_true", help="Fail if a task does not meet minimum text thresholds")
    ap.add_argument("--min-doc-chars", type=int, default=0, help="Minimum total characters per document (strict mode)")
    ap.add_argument("--min-pages-with-text", type=int, default=0, help="Minimum pages with text per document (strict mode)")
    args = ap.parse_args()

    client = Client(url=args.ls_url, api_key=args.api_key)
    project = client.get_project(args.project_id)
    out_root = Path(args.out_dir).resolve()
    out_root.mkdir(parents=True, exist_ok=True)

    # Fetch tasks (pagination handled by SDK)
    tasks = project.get_tasks()
    manifest_path = out_root / "manifest.jsonl"
    count = 0
    failures = 0
    with manifest_path.open("w", encoding="utf-8") as mf:
        for task in tasks:
            data = task.get("data", {})
            pdf_ref = data.get(args.data_key) or data.get("file") or data.get("document")
            if not pdf_ref:
                print(f"Task {task.get('id')} missing data key '{args.data_key}' (or 'file'/'document')", file=sys.stderr)
                failures += 1
                continue

            # Normalize URL: LS may return /data/upload/<id> relative path
            if pdf_ref.startswith("/"):
                pdf_url = args.ls_url.rstrip("/") + pdf_ref
            else:
                pdf_url = pdf_ref

            # Download PDF to temp file
            with tempfile.TemporaryDirectory() as td:
                tmp_pdf = Path(td) / "doc.pdf"
                try:
                    download_url(pdf_url, tmp_pdf, api_key=args.api_key)
                except Exception as e:
                    print(f"Download failed for task {task.get('id')}: {e}", file=sys.stderr)
                    failures += 1
                    continue

                # Extract to JSON using selected engine
                try:
                    headers = {}
                    for h in args.ocr_header:
                        if ":" in h:
                            k, v = h.split(":", 1)
                            headers[k.strip()] = v.strip()
                    doc = extract_pdf_to_json(
                        str(tmp_pdf),
                        include_layout=args.include_layout,
                        engine=args.engine,
                        ocr_url=args.ocr_url,
                        ocr_headers=headers,
                    )
                except Exception as e:
                    print(f"Extraction failed for task {task.get('id')}: {e}", file=sys.stderr)
                    failures += 1
                    continue

            metrics = compute_text_metrics(doc)
            failed = False
            if args.strict:
                min_chars = args.min_doc_chars if args.min_doc_chars > 0 else 1
                min_pages = args.min_pages_with_text if args.min_pages_with_text > 0 else 1
                failed = not (metrics["total_chars"] >= min_chars and metrics["pages_with_text"] >= min_pages)

            # Write JSON alongside manifest
            out_json = out_root / f"task_{task.get('id')}.json"
            with out_json.open("w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False)

            record = {
                "task_id": task.get("id"),
                "pdf": pdf_url,
                "json": str(out_json),
                "page_count": doc.get("page_count", 0),
                "total_chars": metrics["total_chars"],
                "pages_with_text": metrics["pages_with_text"],
                "failed": failed,
            }
            mf.write(json.dumps(record) + "\n")
            count += 1
            if failed:
                failures += 1

    print(f"Processed {count} task(s). Manifest: {manifest_path}")
    if args.strict and failures > 0:
        print(f"Strict mode: {failures} task(s) failed thresholds", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
