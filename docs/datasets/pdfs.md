PDF Dataset (XeT) – Vertical Partitioning

Overview
- Repo: goldfish-inc/pdfs (HF dataset with XeT enabled)
- Partition: by vertical and date
  - <vertical>/<YYYY>/<MM>/<sha256>.pdf
  - manifests/vertical=<vertical>/<YYYY>/<MM>/manifest-<timestamp>.jsonl
- Join key for annotations: manifest row pdf_path

Uploader (local)
1) Install deps: pip install huggingface_hub pypdf
2) Ensure your HF token is available: export HF_TOKEN=hf_...
3) Run uploader:
   python scripts/hf_xet_pdf_uploader.py \
     --repo goldfish-inc/pdfs \
     --vertical maritime \
     --src ./path/to/pdfs

Notes
- The repo must exist on Hugging Face and be configured for XeT in the UI.
- The uploader computes sha256, writes a JSONL manifest, commits PDFs + manifest via Git (XeT-friendly).
- README: You can pass --readme-template docs/dataset-cards/pdfs_README_TEMPLATE.md to bootstrap the dataset card if missing.

Manifest Row Schema
- pdf_path: string (path inside repo, e.g., maritime/2025/10/<sha256>.pdf)
- vertical: string (e.g., maritime)
- sha256: string (hex)
- filename: original file name
- size_bytes: integer
- page_count: integer or null
- ingested_at: ISO timestamp (UTC)

Joining in Training
- Annotations repo (Argilla exports): include vertical and pdf_path
- Filter: vertical == "maritime"
- Join: pdf_path (annotations) → pdf repo path
- Download: via huggingface_hub (Dataset repo, Git/XeT under the hood)

Growth
- Add other verticals (agriculture/forestry) under the same repo
- If ACL or size warrants, split to goldfish-inc/pdfs-<vertical> and add repo field to manifests
