#!/usr/bin/env python3
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Optional

import requests  # type: ignore

try:
    import pdfplumber  # type: ignore
except ImportError as e:
    print("pdfplumber is required. Install with: pip install -r scripts/requirements-extraction.txt", file=sys.stderr)
    raise


def _extract_with_pdfplumber(pdf_path: str, include_layout: bool = False) -> dict:
    """Extract text and tables from a PDF into a structured JSON dict.

    Structure:
    {
      "source_path": str,
      "page_count": int,
      "pages": [
        {
          "page_number": int,
          "width": float,
          "height": float,
          "text": str,
          "tables": [ [[cell,...], ...], ... ]
        }, ...
      ],
      "meta": { "extractor": "pdfplumber", "version": str, "extracted_at": ISO8601 }
    }
    """
    out = {
        "source_path": os.path.abspath(pdf_path),
        "page_count": 0,
        "pages": [],
        "meta": {
            "extractor": "pdfplumber",
            "version": getattr(pdfplumber, "__version__", "unknown"),
            "extracted_at": datetime.now(timezone.utc).isoformat(),
        },
    }

    with pdfplumber.open(pdf_path) as pdf:
        out["page_count"] = len(pdf.pages)
        for idx, page in enumerate(pdf.pages, start=1):
            page_obj = {
                "page_number": idx,
                "width": page.width,
                "height": page.height,
                "text": page.extract_text() or "",
                "tables": [],
            }
            if include_layout:
                try:
                    words = page.extract_words(use_text_flow=True) or []
                    # Keep a compact subset of fields for words
                    page_obj["words"] = [
                        {
                            "text": w.get("text", ""),
                            "x0": w.get("x0"),
                            "y0": w.get("y0"),
                            "x1": w.get("x1"),
                            "y1": w.get("y1"),
                        }
                        for w in words
                    ]
                except Exception:
                    page_obj["words"] = []
            # Try to extract tables with default settings
            try:
                tables = page.extract_tables()
                if tables:
                    page_obj["tables"] = tables
            except Exception:
                # Non-fatal; proceed with text only
                pass

            out["pages"].append(page_obj)

    return out


def _extract_with_deepseek(
    pdf_path: str,
    ocr_url: str,
    include_layout: bool = False,
    headers: Optional[Dict[str, str]] = None,
) -> dict:
    if not ocr_url:
        raise ValueError("--ocr-url is required when engine=deepseek")
    req_headers = headers.copy() if headers else {}
    data = {"include_layout": str(bool(include_layout)).lower()}
    with open(pdf_path, "rb") as f:
        files = {"file": (os.path.basename(pdf_path), f, "application/pdf")}
        resp = requests.post(ocr_url, headers=req_headers, data=data, files=files, timeout=300)
        resp.raise_for_status()
        payload = resp.json()

    # Expect payload to contain pages list with text and optional words.
    # Example expected shape: {"pages": [{"text": "...", "words": [{"text": "...", "x0":...,"y0":...,"x1":...,"y1":...}]}]}
    if not isinstance(payload, dict) or "pages" not in payload:
        raise ValueError("Unexpected DeepSeek OCR response: missing 'pages'")

    pages = payload.get("pages", [])
    if not isinstance(pages, list):
        raise ValueError("Unexpected DeepSeek OCR response: 'pages' is not a list")

    doc = {
        "source_path": os.path.abspath(pdf_path),
        "page_count": len(pages),
        "pages": [],
        "meta": {
            "extractor": "deepseek-ocr",
            "version": str(payload.get("version", "unknown")),
            "extracted_at": datetime.now(timezone.utc).isoformat(),
        },
    }

    for idx, p in enumerate(pages, start=1):
        text = p.get("text") or ""
        words = p.get("words") if include_layout else None
        page_obj = {
            "page_number": idx,
            "width": p.get("width"),
            "height": p.get("height"),
            "text": text,
            "tables": p.get("tables", []),
        }
        if include_layout and isinstance(words, list):
            # Keep compact fields when available
            page_obj["words"] = [
                {
                    "text": w.get("text", ""),
                    "x0": w.get("x0"),
                    "y0": w.get("y0"),
                    "x1": w.get("x1"),
                    "y1": w.get("y1"),
                }
                for w in words
            ]
        doc["pages"].append(page_obj)

    return doc


def extract_pdf_to_json(
    pdf_path: str,
    include_layout: bool = False,
    engine: str = "pdfplumber",
    ocr_url: Optional[str] = None,
    ocr_headers: Optional[Dict[str, str]] = None,
) -> dict:
    engine = engine.lower()
    if engine == "pdfplumber":
        return _extract_with_pdfplumber(pdf_path, include_layout=include_layout)
    if engine == "deepseek":
        return _extract_with_deepseek(pdf_path, ocr_url=ocr_url or "", include_layout=include_layout, headers=ocr_headers)
    raise ValueError(f"Unsupported engine: {engine}")


def compute_text_metrics(doc: dict) -> dict:
    pages = doc.get("pages", [])
    chars_per_page = [len(p.get("text", "")) for p in pages]
    total_chars = sum(chars_per_page)
    pages_with_text = sum(1 for c in chars_per_page if c > 0)
    pages_without_text = [i + 1 for i, c in enumerate(chars_per_page) if c == 0]
    return {
        "total_chars": total_chars,
        "pages_with_text": pages_with_text,
        "pages_without_text": pages_without_text,
    }


def main():
    ap = argparse.ArgumentParser(description="Extract text and tables from a PDF into JSON (no DB)")
    ap.add_argument("--input", required=True, help="Path to input PDF")
    ap.add_argument("--out", help="Path to write JSON output (optional)")
    ap.add_argument("--include-layout", action="store_true", help="Include word-level bounding boxes per page")
    ap.add_argument("--engine", choices=["pdfplumber", "deepseek"], default="pdfplumber", help="Extraction engine to use")
    ap.add_argument("--ocr-url", help="DeepSeek OCR endpoint (required if engine=deepseek)")
    ap.add_argument("--ocr-header", action="append", default=[], help="Additional header for OCR request, e.g. 'Authorization: Bearer TOKEN' (repeatable)")
    ap.add_argument("--strict", action="store_true", help="Fail (non-zero exit) if text is not extracted")
    ap.add_argument("--min-doc-chars", type=int, default=0, help="Minimum total characters across document (strict mode)")
    ap.add_argument("--min-pages-with-text", type=int, default=0, help="Minimum number of pages with any text (strict mode)")
    # Output is JSON only; no database writes here by design.
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        print(f"Input PDF not found: {args.input}", file=sys.stderr)
        sys.exit(2)

    # Parse OCR headers
    headers: Dict[str, str] = {}
    for h in args.ocr_header:
        if ":" not in h:
            print(f"Ignoring malformed header: {h}", file=sys.stderr)
            continue
        k, v = h.split(":", 1)
        headers[k.strip()] = v.strip()

    doc = extract_pdf_to_json(
        args.input,
        include_layout=args.include_layout,
        engine=args.engine,
        ocr_url=args.ocr_url,
        ocr_headers=headers,
    )
    metrics = compute_text_metrics(doc)
    doc.setdefault("meta", {})["metrics"] = metrics

    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)
        print(f"Wrote JSON: {args.out}")
    else:
        print(json.dumps(doc, ensure_ascii=False))

    # Strict validation: enforce minimum text presence when requested.
    if args.strict:
        min_chars = args.min_doc_chars if args.min_doc_chars > 0 else 1
        min_pages = args.min_pages_with_text if args.min_pages_with_text > 0 else 1
        ok = (metrics["total_chars"] >= min_chars) and (metrics["pages_with_text"] >= min_pages)
        if not ok:
            msg = (
                f"Strict failure: total_chars={metrics['total_chars']} (min {min_chars}), "
                f"pages_with_text={metrics['pages_with_text']} (min {min_pages}), "
                f"pages_without_text={metrics['pages_without_text']}"
            )
            print(msg, file=sys.stderr)
            sys.exit(1)

    # No DB writes; keep extraction output as the single source of truth.


if __name__ == "__main__":
    main()
