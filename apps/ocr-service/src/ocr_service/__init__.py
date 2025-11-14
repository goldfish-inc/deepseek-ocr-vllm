"""FastAPI application for asynchronous DeepSeek OCR ingestion."""

from .app import create_app, app

__all__ = ["create_app", "app"]
