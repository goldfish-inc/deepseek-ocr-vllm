#!/usr/bin/env python3
"""
Export PDF page boxes as PDF-point coordinates.

Two data sources supported:
1) Database (preferred): reads stage.pdf_boxes and converts percent -> PDF points using the source PDF page size.
   - Requires: DATABASE_URL env var and psycopg2 installed.
   - Uses per-row pdf_url if present; otherwise attempts to fetch from Label Studio task.

2) Label Studio API (fallback): fetches rectangle annotations for a project and computes PDF points directly.
   - Requires: LABEL_STUDIO_URL + LABEL_STUDIO_PAT (PAT refresh -> access token) or ESC-accessible PAT.

Output: JSONL to stdout with fields: project_id, task_id, page, label, x_pt, y_pt, w_pt, h_pt, page_width_pt, page_height_pt, pdf_url

Usage examples:
  # Database path (preferred)
  export DATABASE_URL=postgresql://user:pass@host:5432/db
  python3 scripts/export_pdf_boxes.py --project 1 > pdf_boxes.jsonl

  # Label Studio fallback (no DB)
  export LABEL_STUDIO_URL=https://label.boathou.se
  export LABEL_STUDIO_PAT=$(esc env get default/oceanid-cluster pulumiConfig.oceanid-cluster:labelStudioPat --value string --show-secrets)
  python3 scripts/export_pdf_boxes.py --project 1 --ls-only > pdf_boxes.jsonl
"""

import argparse
import io
import json
import os
import sys
from typing import Any, Dict, Iterable, Optional, Tuple

import urllib.request
import urllib.error

try:
    import psycopg2  # type: ignore
except Exception:
    psycopg2 = None

try:
    import requests  # type: ignore
except Exception:
    requests = None

try:
    import pypdf  # type: ignore
except Exception:
    pypdf = None


def _pdf_page_size(url: str, page_index0: int) -> Optional[Tuple[float, float]]:
    if pypdf is None or requests is None:
        return None
    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        reader = pypdf.PdfReader(io.BytesIO(r.content))
        if 0 <= page_index0 < len(reader.pages):
            m = reader.pages[page_index0].mediabox
            # pypdf mediabox values are in default user units (points)
            return float(m.width), float(m.height)
    except Exception:
        return None
    return None


def _ls_access_token(ls_url: str, pat: str) -> Optional[str]:
    try:
        r = requests.post(f"{ls_url.rstrip('/')}/api/token/refresh", json={"refresh": pat}, timeout=15)
        if r.status_code == 200:
            return r.json().get("access")
    except Exception:
        return None
    return None


def _ls_get_json(ls_url: str, access: str, path: str, params: Optional[Dict[str, Any]] = None) -> Optional[Any]:
    try:
        r = requests.get(f"{ls_url.rstrip('/')}{path}", headers={"Authorization": f"Bearer {access}"}, params=params, timeout=20)
        if r.status_code == 200:
            return r.json()
    except Exception:
        return None
    return None


def export_db(project: Optional[str]) -> int:
    if psycopg2 is None:
        print("psycopg2 not available; cannot use DB export", file=sys.stderr)
        return 2
    dburl = os.getenv("DATABASE_URL")
    if not dburl:
        print("DATABASE_URL not set", file=sys.stderr)
        return 2
    q = "select pb.project_id, pb.external_task_id, pb.page, pb.label, pb.x_pct, pb.y_pct, pb.w_pct, pb.h_pct, pb.image_width, pb.image_height, coalesce(pb.pdf_url,''), coalesce(pb.image_url,'') from stage.pdf_boxes pb"
    if project:
        q += " where pb.project_id = %s"
    try:
        conn = psycopg2.connect(dburl)
        cur = conn.cursor()
        if project:
            cur.execute(q, (str(project),))
        else:
            cur.execute(q)
        rows = cur.fetchall()
    except Exception as e:
        print(f"DB query failed: {e}", file=sys.stderr)
        return 2
    count = 0
    for (proj, task_id, page, label, x_pct, y_pct, w_pct, h_pct, img_w, img_h, pdf_url, image_url) in rows:
        page_idx0 = max(int(page or 0) - 1, 0)
        width_pt = height_pt = None
        if pdf_url:
            sz = _pdf_page_size(pdf_url, page_idx0)
            if sz:
                width_pt, height_pt = sz
        if width_pt is None or height_pt is None:
            # Skip if cannot resolve PDF size
            continue
        w_pt = (float(w_pct)/100.0) * width_pt
        h_pt = (float(h_pct)/100.0) * height_pt
        x_pt = (float(x_pct)/100.0) * width_pt
        # LS y is top-left; PDF y origin is bottom-left
        y_pt = height_pt - ((float(y_pct)/100.0) * height_pt) - h_pt
        rec = {
            "project_id": proj,
            "task_id": task_id,
            "page": int(page or 0),
            "label": label,
            "x_pt": x_pt,
            "y_pt": y_pt,
            "w_pt": w_pt,
            "h_pt": h_pt,
            "page_width_pt": width_pt,
            "page_height_pt": height_pt,
            "pdf_url": pdf_url or None,
        }
        print(json.dumps(rec, ensure_ascii=False))
        count += 1
    return 0 if count > 0 else 1


def export_ls(project: str, ls_url: str, pat: str) -> int:
    if requests is None:
        print("requests not available; cannot use LS export", file=sys.stderr)
        return 2
    access = _ls_access_token(ls_url, pat)
    if not access:
        print("Failed to obtain LS access token", file=sys.stderr)
        return 2
    # Fetch tasks for project
    tasks = _ls_get_json(ls_url, access, "/api/tasks/", params={"project": project, "page_size": 1000}) or []
    count = 0
    for t in tasks if isinstance(tasks, list) else tasks.get("results", []):
        task_id = t.get("id")
        data = t.get("data") or {}
        # Guess pdf_url
        pdf_url = data.get("pdf_url") or data.get("pdf") or data.get("document") or data.get("url") or ""
        # Pull annotations for task
        anns = _ls_get_json(ls_url, access, f"/api/tasks/{task_id}/annotations") or []
        for a in anns if isinstance(anns, list) else anns.get("results", []):
            res = a.get("result") or []
            for r in res:
                if (r.get("type") or "").lower() != "rectanglelabels":
                    continue
                val = r.get("value") or {}
                x_pct = float(val.get("x", 0.0)); y_pct = float(val.get("y", 0.0))
                w_pct = float(val.get("width", 0.0)); h_pct = float(val.get("height", 0.0))
                labels = val.get("rectanglelabels") or []
                label = labels[0] if labels else None
                if label is None:
                    continue
                page = int(data.get("page") or data.get("page_number") or 1)
                # Compute PDF size
                width_pt = height_pt = None
                if pdf_url:
                    sz = _pdf_page_size(pdf_url, max(page-1, 0))
                    if sz:
                        width_pt, height_pt = sz
                if width_pt is None or height_pt is None:
                    continue
                w_pt = (w_pct/100.0) * width_pt
                h_pt = (h_pct/100.0) * height_pt
                x_pt = (x_pct/100.0) * width_pt
                y_pt = height_pt - ((y_pct/100.0) * height_pt) - h_pt
                rec = {
                    "project_id": str(project),
                    "task_id": str(task_id),
                    "page": int(page or 0),
                    "label": label,
                    "x_pt": x_pt,
                    "y_pt": y_pt,
                    "w_pt": w_pt,
                    "h_pt": h_pt,
                    "page_width_pt": width_pt,
                    "page_height_pt": height_pt,
                    "pdf_url": pdf_url or None,
                }
                print(json.dumps(rec, ensure_ascii=False))
                count += 1
    return 0 if count > 0 else 1


def main():
    p = argparse.ArgumentParser(description="Export PDF boxes to PDF-point coordinates")
    p.add_argument("--project", help="Project ID to filter (optional)")
    p.add_argument("--ls-only", action="store_true", help="Use Label Studio API only (no DB)")
    p.add_argument("--label-studio-url", dest="ls_url", default=os.getenv("LABEL_STUDIO_URL") or "https://label.boathou.se")
    p.add_argument("--pat", help="Label Studio PAT (if not set, tries ESC)")
    args = p.parse_args()

    # Try DB path unless ls-only
    if not args.ls_only:
        code = export_db(args.project)
        if code in (0,):
            sys.exit(0)
        # else fall through to LS

    # LS fallback
    pat = args.pat or os.getenv("LABEL_STUDIO_PAT")
    if not pat:
        # Attempt to read from ESC
        try:
            pat = urllib.request.check_output(["esc","env","get","default/oceanid-cluster","pulumiConfig.oceanid-cluster:labelStudioPat","--value","string","--show-secrets"], text=True).strip()  # type: ignore
        except Exception:
            pass
    if not pat:
        print("LABEL_STUDIO_PAT not provided and ESC unavailable", file=sys.stderr)
        sys.exit(2)
    code = export_ls(args.project or "", args.ls_url, pat)
    sys.exit(code)


if __name__ == "__main__":
    main()

