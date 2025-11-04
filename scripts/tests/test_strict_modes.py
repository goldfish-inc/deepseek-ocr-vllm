import os
import tempfile
from pathlib import Path

from reportlab.lib.pagesizes import letter  # type: ignore
from reportlab.pdfgen import canvas  # type: ignore

from scripts.pdf_extract import main as extract_main
from scripts.batch_extract import main as batch_main


def _blank_pdf(path: str):
    c = canvas.Canvas(path, pagesize=letter)
    c.showPage()
    c.save()


def _text_pdf(path: str, text: str):
    c = canvas.Canvas(path, pagesize=letter)
    w, h = letter
    c.setFont("Helvetica", 12)
    c.drawString(72, h - 72, text)
    c.showPage()
    c.save()


def test_extract_strict_pass(monkeypatch):
    with tempfile.TemporaryDirectory() as td:
        pdf = Path(td) / "ok.pdf"
        out = Path(td) / "ok.json"
        _text_pdf(str(pdf), "Hello")

        import sys
        argv = sys.argv
        try:
            sys.argv = [
                "pdf_extract.py",
                "--input", str(pdf),
                "--out", str(out),
                "--strict",
            ]
            extract_main()
        finally:
            sys.argv = argv

        assert out.exists()


def test_extract_strict_fail(monkeypatch):
    with tempfile.TemporaryDirectory() as td:
        pdf = Path(td) / "blank.pdf"
        out = Path(td) / "blank.json"
        _blank_pdf(str(pdf))

        import sys
        argv = sys.argv
        try:
            sys.argv = [
                "pdf_extract.py",
                "--input", str(pdf),
                "--out", str(out),
                "--strict",
            ]
            try:
                extract_main()
                assert False, "Expected SystemExit"
            except SystemExit as e:
                assert e.code == 1
        finally:
            sys.argv = argv


def test_batch_strict_fail(monkeypatch):
    with tempfile.TemporaryDirectory() as td:
        in_dir = Path(td) / "in"
        out_dir = Path(td) / "out"
        in_dir.mkdir()
        _blank_pdf(str(in_dir / "blank.pdf"))

        import sys
        argv = sys.argv
        try:
            sys.argv = [
                "batch_extract.py",
                "--input-dir", str(in_dir),
                "--out-dir", str(out_dir),
                "--strict",
            ]
            try:
                batch_main()
                assert False, "Expected SystemExit"
            except SystemExit as e:
                assert e.code == 1
        finally:
            sys.argv = argv
