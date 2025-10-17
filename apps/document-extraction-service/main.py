"""
Document Extraction Service

Lightweight HTTP service for extracting text from documents using IBM Granite Docling.
Supports PDF, images (JPEG/PNG/HEIC), CSV, XLSX, DOCX, PPTX, and more.

Architecture:
- POST /extract - Extract text from uploaded document
- GET /health - Health check endpoint
- GET /formats - List supported formats

Uses docling library with MLX acceleration on Apple Silicon.
"""

import os
import tempfile
from pathlib import Path
from typing import Optional
import logging

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Document Extraction Service",
    description="Extract text from documents using IBM Granite Docling",
    version="1.0.0"
)

# Initialize docling converter (reuse for performance)
converter = DocumentConverter()

# Response models
class ExtractionResult(BaseModel):
    text: str
    format: str
    pages: Optional[int] = None
    word_count: int
    char_count: int
    error: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    version: str
    mlx_enabled: bool

class FormatsResponse(BaseModel):
    supported_formats: list[str]
    total_count: int


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        mlx_enabled=os.environ.get("DOCLING_USE_MLX", "1") == "1"
    )


@app.get("/formats", response_model=FormatsResponse)
async def list_formats():
    """List all supported document formats."""
    formats = [fmt.value for fmt in InputFormat]
    return FormatsResponse(
        supported_formats=formats,
        total_count=len(formats)
    )


@app.post("/extract", response_model=ExtractionResult)
async def extract_document(file: UploadFile = File(...)):
    """
    Extract text from an uploaded document.

    Supports: PDF, images (JPEG/PNG/HEIC), CSV, XLSX, DOCX, PPTX, HTML, MD, and more.

    Args:
        file: Uploaded document file

    Returns:
        ExtractionResult with extracted text and metadata
    """
    temp_path = None
    try:
        # Get file extension
        filename = file.filename or "document"
        ext = Path(filename).suffix.lower()

        # Detect format
        format_map = {
            '.pdf': InputFormat.PDF,
            '.jpg': InputFormat.IMAGE,
            '.jpeg': InputFormat.IMAGE,
            '.png': InputFormat.IMAGE,
            '.heic': InputFormat.IMAGE,
            '.csv': InputFormat.CSV,
            '.xlsx': InputFormat.XLSX,
            '.docx': InputFormat.DOCX,
            '.pptx': InputFormat.PPTX,
            '.html': InputFormat.HTML,
            '.md': InputFormat.MD,
            '.xml': InputFormat.XML_USPTO,
        }

        doc_format = format_map.get(ext)
        if not doc_format:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported format: {ext}. Supported: {list(format_map.keys())}"
            )

        # Write uploaded file to temp location
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            content = await file.read()
            tmp.write(content)
            temp_path = tmp.name

        logger.info(f"Processing {filename} ({len(content)} bytes) with format {doc_format.value}")

        # Convert document
        result = converter.convert(temp_path)

        # Extract text
        text = result.document.export_to_markdown()

        # Calculate metadata
        word_count = len(text.split())
        char_count = len(text)

        # Try to get page count (PDF only)
        pages = None
        if doc_format == InputFormat.PDF:
            try:
                pages = len(result.document.pages)
            except:
                pass

        logger.info(f"Extracted {word_count} words, {char_count} chars from {filename}")

        return ExtractionResult(
            text=text,
            format=doc_format.value,
            pages=pages,
            word_count=word_count,
            char_count=char_count
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Extraction failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Extraction failed: {str(e)}"
        )
    finally:
        # Clean up temp file
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except:
                pass


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
