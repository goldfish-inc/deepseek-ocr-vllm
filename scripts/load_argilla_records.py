#!/usr/bin/env python3
"""
Load merged Argilla records (pages + suggestions) into an Argilla dataset.

Usage:
  python scripts/load_argilla_records.py \
    --parquet s3://bucket/argilla/in/vessels_ocr_BATCHID/argilla_records.parquet \
    --dataset vessels_ocr_BATCHID \
    --api-url https://argilla.example.com \
    --api-key ******** \
    [--batch-size 200]

Notes:
  - Expects Parquet from sql/motherduck/merge_suggestions_for_argilla.sql
    with columns: id, text, doc_id, page_num, text_sha256, suggestions_json
  - Does NOT create the dataset; create it ahead of time per your Argilla setup.
  - Requires: pip install duckdb requests
"""

import argparse
import json
import math
import sys
from typing import List, Dict, Any

import duckdb  # type: ignore
import requests  # type: ignore


def chunked(iterable: List[Any], n: int) -> List[List[Any]]:
    return [iterable[i : i + n] for i in range(0, len(iterable), n)]


def build_record(row: Dict[str, Any]) -> Dict[str, Any]:
    # suggestions_json may be None or already a Python list or a JSON string
    suggestions_raw = row.get("suggestions_json")
    suggestions: List[Dict[str, Any]]
    if suggestions_raw is None:
        suggestions = []
    elif isinstance(suggestions_raw, str):
        try:
            suggestions = json.loads(suggestions_raw)
        except json.JSONDecodeError:
            suggestions = []
    elif isinstance(suggestions_raw, list):
        suggestions = suggestions_raw
    else:
        suggestions = []

    return {
        "id": row["id"],
        "fields": {
            "text": row["text"],
            "doc_id": row["doc_id"],
            "page_num": int(row["page_num"]),
            "text_sha256": row.get("text_sha256"),
        },
        "suggestions": suggestions,
    }


def load_parquet_to_dicts(parquet_uri: str) -> List[Dict[str, Any]]:
    con = duckdb.connect()
    # For large datasets, consider reading in slices with LIMIT/OFFSET
    df = con.execute(f"SELECT * FROM read_parquet('{parquet_uri}')").df()
    # Normalize column names
    records = []
    for _, r in df.iterrows():
        row = {k: r[k] for k in df.columns}
        records.append(build_record(row))
    return records


def post_records(api_url: str, api_key: str, dataset: str, records: List[Dict[str, Any]], batch_size: int = 200) -> None:
    url = api_url.rstrip("/") + f"/api/v1/datasets/{dataset}/records"
    headers = {
        "Content-Type": "application/json",
        # Some Argilla deployments use X-Argilla-API-Key instead of Authorization
        "Authorization": f"ApiKey {api_key}",
        "X-Argilla-API-Key": api_key,
    }
    total = len(records)
    sent = 0
    for batch in chunked(records, batch_size):
        resp = requests.post(url, headers=headers, data=json.dumps(batch), timeout=60)
        if resp.status_code >= 400:
            print(f"Error posting batch at offset {sent}: {resp.status_code} {resp.text}", file=sys.stderr)
            resp.raise_for_status()
        sent += len(batch)
        print(f"Posted {sent}/{total} records…")


def main() -> None:
    parser = argparse.ArgumentParser(description="Load Argilla records from merged Parquet")
    parser.add_argument("--parquet", required=True, help="Parquet URI (s3://… or local path)")
    parser.add_argument("--dataset", required=True, help="Argilla dataset name (e.g., vessels_ocr_BATCHID)")
    parser.add_argument("--api-url", required=True, help="Argilla base URL")
    parser.add_argument("--api-key", required=True, help="Argilla API key")
    parser.add_argument("--batch-size", type=int, default=200, help="Records per POST")

    args = parser.parse_args()

    print(f"Reading Parquet: {args.parquet}")
    records = load_parquet_to_dicts(args.parquet)
    if not records:
        print("No records found; exiting.")
        return

    print(f"Posting {len(records)} records to dataset {args.dataset}")
    post_records(args.api_url, args.api_key, args.dataset, records, args.batch_size)
    print("Done.")


if __name__ == "__main__":
    main()
