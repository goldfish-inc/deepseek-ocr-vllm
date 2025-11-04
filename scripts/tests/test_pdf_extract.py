import io
import json
import os
import tempfile

from reportlab.lib.pagesizes import letter  # type: ignore
from reportlab.pdfgen import canvas  # type: ignore

from scripts.pdf_extract import extract_pdf_to_json


def _make_sample_pdf(path: str):
    # Create a simple PDF with some text and a drawn table-like layout
    c = canvas.Canvas(path, pagesize=letter)
    width, height = letter
    c.setFont("Helvetica", 12)
    c.drawString(72, height - 72, "Hello, PDF extraction!")
    # Draw a 2x2 grid (not guaranteed table extraction, but text extraction is reliable)
    x0, y0 = 72, height - 200
    cell_w, cell_h = 120, 24
    for i in range(3):
        c.line(x0, y0 - i * cell_h, x0 + 2 * cell_w, y0 - i * cell_h)
    for j in range(3):
        c.line(x0 + j * cell_w, y0, x0 + j * cell_w, y0 - 2 * cell_h)
    c.drawString(x0 + 4, y0 - 18, "A1")
    c.drawString(x0 + cell_w + 4, y0 - 18, "A2")
    c.drawString(x0 + 4, y0 - cell_h - 18, "B1")
    c.drawString(x0 + cell_w + 4, y0 - cell_h - 18, "B2")
    c.showPage()
    c.save()


def test_extract_pdf_to_json_text_and_meta():
    with tempfile.TemporaryDirectory() as td:
        pdf_path = os.path.join(td, "sample.pdf")
        _make_sample_pdf(pdf_path)
        doc = extract_pdf_to_json(pdf_path)
        assert doc["page_count"] == 1
        assert doc["pages"][0]["text"].lower().find("hello, pdf extraction") != -1
        assert doc["meta"]["extractor"] == "pdfplumber"
        assert "extracted_at" in doc["meta"]
