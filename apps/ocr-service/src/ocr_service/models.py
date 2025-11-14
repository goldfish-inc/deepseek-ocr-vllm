from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class StorageArtifact(BaseModel):
    uri: str
    path: str
    size_bytes: int
    sha256: str


class QueueTask(BaseModel):
    task_id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    storage_uri: str
    storage_path: str
    submitted_at: datetime
    priority: int = Field(default=5, ge=0, le=9)
    submitted_by: str | None = None


class TaskRecord(BaseModel):
    task_id: str
    filename: str
    status: TaskStatus
    content_type: str
    size_bytes: int
    sha256: str
    storage_uri: str
    storage_path: str
    queue_name: str
    submitted_at: datetime
    updated_at: datetime
    priority: int = Field(default=5, ge=0, le=9)
    submitted_by: str | None = None
    error_message: str | None = None
    retry_count: int = 0


class UploadResponse(BaseModel):
    task_id: str
    status: TaskStatus
    received_bytes: int
    sha256: str
    storage_uri: str
    queue_depth: int
    status_url: str


class StatusResponse(BaseModel):
    task: TaskRecord
    queue_depth: int


class HealthResponse(BaseModel):
    status: Literal["ok"]
    queue_depth: int


class ReadyResponse(BaseModel):
    status: Literal["ready"]
    queue_depth: int
    storage_writable: bool
