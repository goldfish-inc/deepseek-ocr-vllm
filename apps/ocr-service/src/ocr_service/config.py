from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    app_name: str = "DeepSeek OCR Service"
    environment: str = Field(default="prod", validation_alias="ENVIRONMENT")

    redis_url: str = Field(default="redis://localhost:6379/0")
    queue_name: str = Field(default="ocr:tasks")
    task_status_prefix: str = Field(default="ocr:task:")
    task_ttl_seconds: int = Field(default=7 * 24 * 60 * 60)

    storage_mode: Literal["local", "s3"] = Field(default="local")
    storage_root: Path = Field(default=Path("/data/ocr-inbox"))
    storage_prefix: str = Field(default="ingest")
    storage_base_uri: str | None = None

    s3_bucket: str | None = None
    s3_region: str | None = None
    s3_endpoint_url: str | None = None

    max_pdf_size_mb: int = Field(default=80, ge=1, le=512)
    allowed_extensions: set[str] = Field(default_factory=lambda: {"pdf"})

    request_timeout_seconds: int = Field(default=30)
    status_history_size: int = Field(default=100)

    model_config = SettingsConfigDict(env_prefix="OCR_SERVICE_", extra="ignore")

    @property
    def max_pdf_bytes(self) -> int:
        return self.max_pdf_size_mb * 1024 * 1024


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
