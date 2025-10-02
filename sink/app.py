import os
import json
import datetime as dt
from typing import Any, Dict, List

import asyncio
import uvicorn
from fastapi import FastAPI, Request

DATABASE_URL = os.getenv("DATABASE_URL")
_pg_pool = None
try:
    if DATABASE_URL:
        import asyncpg  # type: ignore
    else:
        asyncpg = None
except Exception:
    asyncpg = None

from huggingface_hub import HfApi, create_repo, CommitOperationAdd
import httpx, csv, io, zipfile, xml.etree.ElementTree as ET

HF_TOKEN = os.getenv("HF_TOKEN")
HF_REPO = os.getenv("HF_REPO", "goldfish-inc/oceanid-annotations")
SCHEMA_VERSION = os.getenv("SCHEMA_VERSION", "1.0.0")
SUBDIR_TEMPLATE = os.getenv("SUBDIR_TEMPLATE", "annotations/{date}/project-{project_id}.jsonl")

app = FastAPI()

async def _maybe_init_pg():
    global _pg_pool
    if not DATABASE_URL or asyncpg is None or _pg_pool is not None:
        return
    try:
        _pg_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)
        async with _pg_pool.acquire() as conn:
            await conn.execute("""
            create schema if not exists stage;
            create table if not exists stage.documents (
                id bigserial primary key,
                external_id text,
                source text,
                content text,
                created_at timestamptz default now()
            );
            create table if not exists stage.extractions (
                id bigserial primary key,
                document_id bigint references stage.documents(id) on delete cascade,
                label text,
                value text,
                start int,
                "end" int,
                confidence double precision,
                db_mapping text,
                annotator text,
                updated_at timestamptz default now()
            );
            create table if not exists stage.table_ingest (
                id bigserial primary key,
                document_id bigint references stage.documents(id) on delete cascade,
                rows_json jsonb,
                meta jsonb,
                created_at timestamptz default now()
            );
            create table if not exists stage.pdf_boxes (
                id bigserial primary key,
                document_id bigint references stage.documents(id) on delete cascade,
                external_task_id text,
                label text,
                page int,
                x_pct double precision,
                y_pct double precision,
                w_pct double precision,
                h_pct double precision,
                image_width int,
                image_height int,
                image_url text,
                annotator text,
                created_at timestamptz default now()
            );
            """)
    except Exception:
        _pg_pool = None

def _jsonl_path(project_id: Any) -> str:
    date = dt.date.today().strftime("%Y-%m-%d")
    return SUBDIR_TEMPLATE.format(date=date, project_id=project_id)

def _xlsx_rows(data: bytes) -> List[List[str]]:
    rows: List[List[str]] = []
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        shared: List[str] = []
        try:
            with z.open('xl/sharedStrings.xml') as f:
                root = ET.parse(f).getroot()
                for si in root.iter():
                    if si.tag.endswith('}si'):
                        texts = []
                        for t in si.iter():
                            if t.tag.endswith('}t') and t.text:
                                texts.append(t.text)
                        shared.append(''.join(texts))
        except KeyError:
            shared = []
        for name in z.namelist():
            if not name.startswith('xl/worksheets/sheet') or not name.endswith('.xml'):
                continue
            with z.open(name) as f:
                root = ET.parse(f).getroot()
                for row in root.iter():
                    if row.tag.endswith('}row'):
                        vals: List[str] = []
                        for c in row:
                            if not hasattr(c, 'tag') or not c.tag.endswith('}c'):
                                continue
                            t_attr = c.attrib.get('t')
                            v_text = None
                            for v in c:
                                if getattr(v, 'tag', '').endswith('}v') and v.text is not None:
                                    v_text = v.text
                                    break
                            if v_text is None:
                                continue
                            if t_attr == 's':
                                try:
                                    idx = int(v_text)
                                    v_text = shared[idx] if 0 <= idx < len(shared) else v_text
                                except Exception:
                                    pass
                            vals.append(str(v_text))
                        if vals:
                            rows.append(vals)
    except Exception:
        return []
    return rows

@app.get("/health")
async def health():
    return {"ok": True}

@app.post("/webhook")
async def webhook(req: Request):
    await _maybe_init_pg()
    payload = await req.json()
    project_id = payload.get("project_id") or (payload.get("project") or {}).get("id")
    task = payload.get("task") or {}
    text = (task.get("data") or {}).get("text")
    annotator = (payload.get("annotation", {}) or {}).get("completed_by") or payload.get("user") or "unknown"
    doc = {
        "doc_id": task.get("id") or payload.get("task_id"),
        "text": text,
        "schema_version": SCHEMA_VERSION,
        "annotated_at": dt.datetime.utcnow().isoformat() + "Z",
        "annotator": str(annotator),
        "source": "label_studio",
        "spans": [],
        "metadata": {
            "project_id": str(project_id),
            "task_id": str(task.get("id") or payload.get("task_id")),
        },
    }
    # Append to HF JSONL
    hf_ok = False
    try:
        api = HfApi(token=HF_TOKEN)
        relpath = _jsonl_path(project_id)
        try:
            old = api.hf_hub_download(HF_REPO, relpath, repo_type="dataset", token=HF_TOKEN)
            with open(old, "r", encoding="utf-8") as f:
                prev = f.read().rstrip()
            content = prev + "\n" + json.dumps(doc, ensure_ascii=False)
        except Exception:
            content = json.dumps(doc, ensure_ascii=False)
        op = CommitOperationAdd(path_in_repo=relpath, path_or_fileobj=content.encode("utf-8"), encoding=None)
        api.create_commit(repo_id=HF_REPO, repo_type="dataset", operations=[op], commit_message=f"append {doc['metadata']['task_id']}")
        hf_ok = True
    except Exception:
        hf_ok = False
    # Insert doc + any rectangle labels (image boxes) into PG
    if _pg_pool is not None:
        try:
            async with _pg_pool.acquire() as conn:
                task_id = doc["metadata"].get("task_id")
                # Ensure a document row exists and capture id
                doc_id = await conn.fetchval("select id from stage.documents where external_id=$1", task_id)
                if not doc_id:
                    doc_id = await conn.fetchval(
                        "insert into stage.documents(external_id, source, content) values($1,$2,$3) returning id",
                        task_id, "label_studio", text or ""
                    )
                # Parse rectangle labels if present
                ann = payload.get("annotation") or {}
                results = ann.get("result") or []
                if isinstance(results, list):
                    data = (task.get("data") or {}) if isinstance(task, dict) else {}
                    image_url = None
                    for key in ("image", "image_url", "img", "file", "file_upload"):
                        v = data.get(key)
                        if isinstance(v, str) and (v.startswith("http://") or v.startswith("https://")):
                            image_url = v
                            break
                    for r in results:
                        try:
                            if not isinstance(r, dict):
                                continue
                            if (r.get("type") or "").lower() != "rectanglelabels":
                                continue
                            val = r.get("value") or {}
                            # LS reports percentages 0-100
                            x_pct = float(val.get("x", 0.0))
                            y_pct = float(val.get("y", 0.0))
                            w_pct = float(val.get("width", 0.0))
                            h_pct = float(val.get("height", 0.0))
                            labels = val.get("rectanglelabels") or []
                            label = labels[0] if labels else None
                            if label is None:
                                continue
                            img_w = int(r.get("original_width") or 0)
                            img_h = int(r.get("original_height") or 0)
                            page = int((data.get("page") or data.get("page_number") or 0) or 0)
                            await conn.execute(
                                """
                                insert into stage.pdf_boxes(
                                    document_id, external_task_id, label, page,
                                    x_pct, y_pct, w_pct, h_pct,
                                    image_width, image_height, image_url, annotator
                                ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                                """,
                                doc_id, str(task_id), str(label), page,
                                x_pct, y_pct, w_pct, h_pct,
                                img_w, img_h, image_url, str(annotator)
                            )
                        except Exception:
                            continue
        except Exception:
            pass
    return {"ok": True, "hf_commit": hf_ok}

@app.post("/ingest")
async def ingest(req: Request):
    await _maybe_init_pg()
    payload = await req.json()
    tasks = []
    if isinstance(payload, dict):
        t = payload.get("tasks") or payload.get("task") or payload.get("data")
        if isinstance(t, list):
            tasks = t
        elif isinstance(t, dict):
            tasks = [t]
    if not tasks:
        return {"ok": True, "ingested": 0}
    ingested = 0
    for t in tasks:
        data = (t.get("data") if isinstance(t, dict) else None) or t
        text = (data or {}).get("text") if isinstance(data, dict) else None
        url = None
        if isinstance(data, dict):
            for k in ("file","file_upload","document","url","pdf"):
                v = data.get(k)
                if isinstance(v, str) and (v.startswith("http://") or v.startswith("https://")):
                    url = v
                    break
        rows = None
        doc_text = None
        try:
            if url and url.lower().endswith(".csv"):
                async with httpx.AsyncClient(timeout=20.0) as client:
                    r = await client.get(url)
                    r.raise_for_status()
                    rdr = list(csv.reader(io.StringIO(r.text)))
                    rows = rdr
                    lines = []
                    if rdr:
                        headers = rdr[0]
                        is_header = any(any(c.isalpha() for c in (h or "")) for h in headers)
                        if is_header:
                            for row in rdr[1:]:
                                parts = []
                                for h, v in zip(headers, row):
                                    hv=(h or "").strip(); vv=(v or "").strip()
                                    if hv and vv:
                                        parts.append(f"{hv}: {vv}")
                                if parts:
                                    lines.append(", ".join(parts))
                        else:
                            lines = [", ".join(r) for r in rdr]
                    doc_text = "\n".join(lines)[:5000]
            elif url and url.lower().endswith(".xlsx"):
                async with httpx.AsyncClient(timeout=20.0) as client:
                    r = await client.get(url)
                    r.raise_for_status()
                    rows = _xlsx_rows(r.content)
                    lines = []
                    if rows:
                        headers = rows[0]
                        is_header = any(any(c.isalpha() for c in (h or "")) for h in headers)
                        if is_header:
                            for row in rows[1:]:
                                parts=[]
                                for h, v in zip(headers, row):
                                    hv=(h or "").strip(); vv=(v or "").strip()
                                    if hv and vv:
                                        parts.append(f"{hv}: {vv}")
                                if parts:
                                    lines.append(", ".join(parts))
                        else:
                            lines = [", ".join(r) for r in rows]
                    doc_text = "\n".join(lines)[:5000]
            elif text:
                doc_text = str(text)
            else:
                continue
            if _pg_pool is not None:
                await _insert_table(doc_text or "", rows or [], {"project_id": payload.get("project_id"), "type": "ingest"})
            ingested += 1
        except Exception:
            continue
    return {"ok": True, "ingested": ingested}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
