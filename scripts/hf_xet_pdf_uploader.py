#!/usr/bin/env python3
"""
HF XeT PDF Uploader

Uploads PDFs to a Hugging Face dataset repo configured with XeT, organized by vertical and date,
and writes a manifest JSONL for join-friendly training.

Requirements:
  pip install huggingface_hub pypdf

Usage examples:
  HF_TOKEN=hf_*** \
  python scripts/hf_xet_pdf_uploader.py \
    --repo goldfish-inc/pdfs \
    --vertical maritime \
    --src ./pdfs_dir

Notes:
  - This uses Git under the hood via huggingface_hub.Repository, which is XeT-friendly for dataset repos.
  - The dataset must already be created and (optionally) enabled for XeT in the Hub UI.
  - Large files are pushed via Git; avoid HTTP commit API for PDFs.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from huggingface_hub import HfApi, Repository

try:
    from pypdf import PdfReader  # lightweight page count
except Exception:  # pragma: no cover
    PdfReader = None  # type: ignore


def sha256_file(path: Path, chunk: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def pdf_page_count(path: Path) -> Optional[int]:
    if PdfReader is None:
        return None
    try:
        return len(PdfReader(str(path)).pages)
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="HF dataset repo id, e.g., goldfish-inc/pdfs")
    ap.add_argument("--vertical", required=True, help="Vertical slug, e.g., maritime")
    ap.add_argument("--src", required=True, help="Directory with PDFs to upload")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--readme-template", default="", help="Optional README template to install if missing")
    ap.add_argument("--max-files", type=int, default=0, help="Limit number of PDFs (0 = no limit)")
    args = ap.parse_args()

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if not token:
        print("ERROR: HF_TOKEN env var is required", file=sys.stderr)
        return 2

    src_dir = Path(args.src)
    if not src_dir.exists() or not src_dir.is_dir():
        print(f"ERROR: src directory not found: {src_dir}", file=sys.stderr)
        return 2

    api = HfApi(token=token)
    # Ensure repo exists and is private by default (do not change visibility here)
    api.create_repo(repo_id=args.repo, repo_type="dataset", private=True, exist_ok=True)

    tmp = Path(tempfile.mkdtemp(prefix="hf_xet_pdfs_"))
    try:
        repo = Repository(
            local_dir=str(tmp),
            clone_from=args.repo,
            repo_type="dataset",
            token=token,
            revision=args.branch,
            git_user="oceanid-bot",
        )
        repo.git_pull(rebase=True)

        # Optional README bootstrap
        if args.readme_template:
            readme_path = tmp / "README.md"
            if not readme_path.exists():
                shutil.copyfile(args.readme_template, readme_path)
                repo.git_add(["README.md"])

        now = datetime.utcnow()
        year = now.strftime("%Y")
        month = now.strftime("%m")

        # Manifest path
        manifest_dir = tmp / "manifests" / f"vertical={args.vertical}" / year / month
        manifest_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = manifest_dir / f"manifest-{now.strftime('%Y%m%dT%H%M%SZ')}.jsonl"

        added = 0
        skipped = 0
        limit = args.max_files if args.max_files > 0 else None

        with manifest_path.open("w", encoding="utf-8") as mf:
            for i, p in enumerate(sorted(src_dir.rglob("*.pdf"))):
                if limit is not None and added >= limit:
                    break
                # Compute hash and destination
                digest = sha256_file(p)
                dest_rel = Path(args.vertical) / year / month / f"{digest}.pdf"
                dest_abs = tmp / dest_rel
                if dest_abs.exists():
                    skipped += 1
                    continue
                dest_abs.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(p, dest_abs)
                size_bytes = dest_abs.stat().st_size
                pages = pdf_page_count(dest_abs)
                rec = {
                    "pdf_path": str(dest_rel).replace("\\", "/"),
                    "vertical": args.vertical,
                    "sha256": digest,
                    "filename": p.name,
                    "size_bytes": size_bytes,
                    "page_count": pages,
                    "ingested_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                }
                mf.write(json.dumps(rec, ensure_ascii=False) + "\n")
                repo.git_add([str(dest_rel)])
                added += 1

        # Add manifest if we wrote anything
        if added > 0:
            rel_manifest = manifest_path.relative_to(tmp)
            repo.git_add([str(rel_manifest)])
            repo.git_commit(f"Add {added} PDFs (vertical={args.vertical}) and manifest {rel_manifest}")
            repo.git_push()
            print(f"✅ Uploaded {added} PDFs, skipped {skipped}. Manifest: {rel_manifest}")
        else:
            print(f"No new PDFs to upload. Skipped existing: {skipped}")

        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
