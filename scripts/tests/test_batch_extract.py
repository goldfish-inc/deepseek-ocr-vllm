import json
import os
import tempfile
from pathlib import Path

from reportlab.lib.pagesizes import letter  # type: ignore
from reportlab.pdfgen import canvas  # type: ignore

from scripts.batch_extract import main as batch_main


def _make_pdf(path: str, text: str):
    c = canvas.Canvas(path, pagesize=letter)
    w, h = letter
    c.setFont("Helvetica", 12)
    c.drawString(72, h - 72, text)
    c.showPage()
    c.save()


def test_batch_extract_creates_json_and_manifest(monkeypatch, capsys):
    with tempfile.TemporaryDirectory() as td:
        in_dir = Path(td) / "in"
        out_dir = Path(td) / "out"
        (in_dir / "nested").mkdir(parents=True)

        _make_pdf(str(in_dir / "a.pdf"), "Doc A")
        _make_pdf(str(in_dir / "nested" / "b.pdf"), "Doc B")

        # Run the batch script via its main() by faking argv
        import sys
        _argv = sys.argv
        try:
            sys.argv = [
                "batch_extract.py",
                "--input-dir", str(in_dir),
                "--out-dir", str(out_dir),
            ]
            batch_main()
        finally:
            sys.argv = _argv

        # Check outputs
        assert (out_dir / "a.json").exists()
        assert (out_dir / "nested" / "b.json").exists()
        manifest = (out_dir / "manifest.jsonl").read_text(encoding="utf-8").strip().splitlines()
        assert len(manifest) == 2
        rec = json.loads(manifest[0])
        assert "page_count" in rec and "chars" in rec
