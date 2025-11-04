Extraction to JSON (No DB, No Fallbacks) — DeepSeek OCR

Single PDF → JSON (DeepSeek)
- Install: `pip install -r scripts/requirements-extraction.txt`
- Run:
  - `python3 scripts/pdf_extract.py --engine deepseek --ocr-url http://deepseek:8000/ocr --input ./doc.pdf --out ./out/doc.json`
  - Add `--ocr-header 'Authorization: Bearer TOKEN'` if your service requires it
  - Add `--include-layout` for word boxes
  - Add `--strict [--min-doc-chars 50 --min-pages-with-text 1]` to fail on low/no text

Batch Directory → JSON + Manifest (DeepSeek)
- `python3 scripts/batch_extract.py --engine deepseek --ocr-url http://deepseek:8000/ocr --input-dir ./pdfs --out-dir ./jsons [--include-layout] [--strict]`
- Outputs JSON per file mirroring structure and `manifest.jsonl` with metrics.

Label Studio → JSON + Manifest (DeepSeek)
- Install LS deps: `pip install -r scripts/requirements-labelstudio.txt`
- Run:
  - `python3 scripts/ls_pull_and_extract.py --ls-url https://ls.example.com --api-key $LS_API_KEY --project-id 123 --out-dir ./data/extractions/ls_123 --data-key pdf --engine deepseek --ocr-url http://deepseek:8000/ocr --strict`
- Writes `task_<id>.json` and a `manifest.jsonl`.

Spark Batch (Cluster, DeepSeek)
- Ensure pdfplumber installed on executors.
- Submit (run from repo root):
  - `spark-submit --master spark://host:7077 --deploy-mode client --py-files scripts/pdf_extract.py apps/spark-jobs/pdf-extract/job.py --engine deepseek --ocr-url http://deepseek:8000/ocr --input-dir /data/pdfs --out-dir /data/extractions --partitions 64 --include-layout --strict --min-doc-chars 50 --min-pages-with-text 1`
- Output: JSON files under `--out-dir` (mirrors input) and `manifest.jsonl`.

Strict Mode Philosophy
- No fallbacks. Either OCR produces text or the job fails with clear metrics.

DeepSeek OCR Expectations
- The OCR endpoint should accept a multipart/form-data POST with field `file` containing the PDF and optional `include_layout=true|false`.
- Response JSON must include `pages`, each with `text` and (optionally) `words` with bounding boxes. Example:

```
{
  "version": "1.0.0",
  "pages": [
    {"text": "...", "words": [{"text":"...","x0":0,"y0":0,"x1":10,"y1":10}], "width": 612, "height": 792}
  ]
}
```
