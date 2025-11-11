#!/usr/bin/env python3
"""
Argilla → Parquet Exporter (Skeleton)
------------------------------------

Purpose
- Export reviewed data from Argilla into partitioned Parquet files compatible with
  MotherDuck loaders in `sql/motherduck/load_annotated_parquet.sql`.
- Emit a `schema.json` manifest per export that records dataset, schema version, and checksum.

Status
- Skeleton implementation with clear extension points. Networking and Argilla API calls are
  not implemented; plug in your Argilla client and record iterators.

Output Layout (R2/S3 or local path)
- <OUTPUT_BASE>/<dataset>/
  - schema.json
  - pages/*.parquet
  - spans/*.parquet

Environment
- ARGILLA_API_URL, ARGILLA_API_KEY (when implementing the client)
- DATASET (e.g., vessels_ocr_2025_11_10)
- OUTPUT_BASE (e.g., s3://your-bucket/argilla/out or ./out)

Usage
  $ export DATASET=vessels_ocr_2025_11_10 OUTPUT_BASE=./out
  $ python scripts/argilla_exporter.py

"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional


@dataclass
class PageRecord:
    argilla_record_id: str
    doc_id: str
    page_num: int
    status: str
    annotator_id: Optional[str]
    reviewer_id: Optional[str]
    record_sha256: str


@dataclass
class SpanRecord:
    argilla_record_id: str
    span_id: str
    doc_id: str
    page_num: int
    label: str
    start: int
    end: int
    text: str
    text_sha256: str
    norm_value: Optional[str]
    annotator_id: Optional[str]


def ensure_local(path: str) -> Path:
    if path.startswith("s3://"):
        raise RuntimeError("This skeleton writes locally only. Sync to R2/S3 separately.")
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def iter_pages(dataset: str) -> Iterable[PageRecord]:
    # TODO: Replace with real Argilla API pagination
    # This yields no records by default.
    if False:  # pragma: no cover
        yield  # type: ignore
    return []


def iter_spans(dataset: str) -> Iterable[SpanRecord]:
    # TODO: Replace with real Argilla API pagination
    if False:  # pragma: no cover
        yield  # type: ignore
    return []


def write_parquet_pages(out_dir: Path, records: Iterable[PageRecord]) -> int:
    try:
        import pandas as pd  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError("pandas is required to write Parquet") from e

    rows = [
        {
            "argilla_record_id": r.argilla_record_id,
            "doc_id": r.doc_id,
            "page_num": r.page_num,
            "status": r.status,
            "annotator_id": r.annotator_id or None,
            "reviewer_id": r.reviewer_id or None,
            "record_sha256": r.record_sha256,
        }
        for r in records
    ]
    if not rows:
        return 0
    df = pd.DataFrame(rows)
    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_dir / "part-00000.parquet", index=False)
    return len(rows)


def write_parquet_spans(out_dir: Path, records: Iterable[SpanRecord]) -> int:
    try:
        import pandas as pd  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError("pandas is required to write Parquet") from e

    rows = [
        {
            "argilla_record_id": r.argilla_record_id,
            "span_id": r.span_id,
            "doc_id": r.doc_id,
            "page_num": r.page_num,
            "label": r.label,
            "start": r.start,
            "end": r.end,
            "text": r.text,
            "text_sha256": r.text_sha256,
            "norm_value": r.norm_value or None,
            "annotator_id": r.annotator_id or None,
        }
        for r in records
    ]
    if not rows:
        return 0
    df = pd.DataFrame(rows)
    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_dir / "part-00000.parquet", index=False)
    return len(rows)


def write_schema_json(base: Path, dataset: str, pages: int, spans: int) -> None:
    schema = {
        "dataset": dataset,
        "version": "v1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "counts": {"pages": pages, "spans": spans},
        "columns": {
            "pages": [
                "argilla_record_id",
                "doc_id",
                "page_num",
                "status",
                "annotator_id",
                "reviewer_id",
                "record_sha256",
            ],
            "spans": [
                "argilla_record_id",
                "span_id",
                "doc_id",
                "page_num",
                "label",
                "start",
                "end",
                "text",
                "text_sha256",
                "norm_value",
                "annotator_id",
            ],
        },
    }
    with (base / "schema.json").open("w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2)


def main() -> int:
    dataset = os.getenv("DATASET") or "vessels_ocr_SAMPLE"
    output_base = os.getenv("OUTPUT_BASE") or "./out"

    base = ensure_local(os.path.join(output_base, dataset))
    pages_dir = base / "pages"
    spans_dir = base / "spans"

    # Fetch from Argilla (replace iterators with real client logic)
    p_count = write_parquet_pages(pages_dir, iter_pages(dataset))
    s_count = write_parquet_spans(spans_dir, iter_spans(dataset))
    write_schema_json(base, dataset, p_count, s_count)
    print(f"Exported: {p_count} pages, {s_count} spans → {base}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
