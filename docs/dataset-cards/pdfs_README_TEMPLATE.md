---
pretty_name: Oceanid PDFs (Vertical-Partitioned)
task_categories:
  - document-understanding
license: other
language:
  - en
size_categories:
  - 10K<n<100K
---

# Oceanid PDFs (XeT)

Curated PDF corpus for document understanding tasks (layout analysis, table/section detection, extraction). Stored in a vertical-partitioned structure and backed by XeT for efficient large-file versioning.

## Structure

```
<vertical>/<YYYY>/<MM>/<sha256>.pdf
manifests/vertical=<vertical>/<YYYY>/<MM>/manifest-<timestamp>.jsonl
```

`vertical` examples: `maritime`, `agriculture`, `forestry`.

## Manifest Schema

One JSON object per line with:

- `pdf_path`: Path within this repo, e.g., `maritime/2025/10/<sha256>.pdf`
- `vertical`: Domain vertical (e.g., `maritime`)
- `sha256`: SHA-256 of the PDF contents
- `filename`: Original filename
- `size_bytes`: File size in bytes
- `page_count`: Page count (when determinable)
- `ingested_at`: ISO-8601 UTC timestamp

## Usage

Python (huggingface_hub):

```python
from huggingface_hub import HfApi, hf_hub_download, list_repo_files
repo = "goldfish-inc/pdfs"
api = HfApi()
files = list_repo_files(repo, repo_type="dataset")
pdfs = [f for f in files if f.startswith("maritime/") and f.endswith(".pdf")]
```

For each training run, prefer pairing with Docling annotations that include `vertical` and `pdf_path` for simple filtering and joins.

## License & Source

This corpus aggregates PDFs from sources with varying licenses. Attribution and usage terms are preserved per-file. See `manifests/*` rows for `source_url` (if present). Contact maintainers for questions about permitted usage.
