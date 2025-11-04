#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Iterable

from scripts.pdf_extract import extract_pdf_to_json, compute_text_metrics


def iter_pdfs(root: Path) -> Iterable[Path]:
    for p in root.rglob("*.pdf"):
        if p.is_file():
            yield p


def main():
    ap = argparse.ArgumentParser(description="Batch extract PDFs in a directory to JSON")
    ap.add_argument("--input-dir", required=True, help="Directory to scan for PDFs (recursive)")
    ap.add_argument("--out-dir", required=True, help="Directory to write JSON outputs (mirrors structure)")
    ap.add_argument("--include-layout", action="store_true", help="Include word-level bounding boxes per page")
    ap.add_argument("--engine", choices=["deepseek", "pdfplumber"], default="pdfplumber", help="Extraction engine (default: pdfplumber)")
    ap.add_argument("--ocr-url", help="DeepSeek OCR endpoint (required for deepseek engine)")
    ap.add_argument("--ocr-header", action="append", default=[], help="Additional header for OCR request, repeatable (e.g., 'Authorization: Bearer TOKEN')")
    ap.add_argument("--strict", action="store_true", help="Fail if any file does not meet text presence minimums")
    ap.add_argument("--min-doc-chars", type=int, default=0, help="Minimum total characters per document (strict mode)")
    ap.add_argument("--min-pages-with-text", type=int, default=0, help="Minimum pages with text per document (strict mode)")
    args = ap.parse_args()

    in_root = Path(args.input_dir).resolve()
    out_root = Path(args.out_dir).resolve()

    if not in_root.exists() or not in_root.is_dir():
        print(f"Input dir not found: {in_root}", file=sys.stderr)
        sys.exit(2)
    out_root.mkdir(parents=True, exist_ok=True)

    manifest = []
    failures = 0
    for pdf_path in iter_pdfs(in_root):
        rel = pdf_path.relative_to(in_root)
        out_path = (out_root / rel).with_suffix(".json")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        headers = {}
        for h in args.ocr_header:
            if ":" in h:
                k, v = h.split(":", 1)
                headers[k.strip()] = v.strip()
        doc = extract_pdf_to_json(
            str(pdf_path),
            include_layout=args.include_layout,
            engine=args.engine,
            ocr_url=args.ocr_url,
            ocr_headers=headers,
        )
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)
        metrics = compute_text_metrics(doc)
        failed = False
        if args.strict:
            min_chars = args.min_doc_chars if args.min_doc_chars > 0 else 1
            min_pages = args.min_pages_with_text if args.min_pages_with_text > 0 else 1
            failed = not (metrics["total_chars"] >= min_chars and metrics["pages_with_text"] >= min_pages)
            if failed:
                failures += 1
        manifest.append({
            "pdf": str(pdf_path),
            "json": str(out_path),
            "page_count": doc.get("page_count", 0),
            "chars": metrics["total_chars"],
            "pages_with_text": metrics["pages_with_text"],
            "failed": failed,
        })

    # Write a simple JSONL manifest
    (out_root / "manifest.jsonl").write_text("\n".join(json.dumps(m) for m in manifest), encoding="utf-8")
    print(f"Processed {len(manifest)} PDFs. Manifest: {out_root / 'manifest.jsonl'}")
    if args.strict and failures > 0:
        print(f"Strict mode: {failures} file(s) failed thresholds", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
