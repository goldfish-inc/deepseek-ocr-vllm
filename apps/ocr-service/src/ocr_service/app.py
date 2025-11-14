from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status

from .config import Settings, get_settings
from .models import (
    HealthResponse,
    QueueTask,
    ReadyResponse,
    StatusResponse,
    TaskRecord,
    TaskStatus,
    UploadResponse,
)
from .queue import TaskQueue
from .repository import TaskRepository
from .storage import LocalStorageBackend, S3StorageBackend, StorageBackend, build_storage_key

LOGGER = logging.getLogger(__name__)


@dataclass
class ServiceState:
    settings: Settings
    queue: TaskQueue
    storage: StorageBackend
    repo: TaskRepository | None = None


def create_storage_backend(settings: Settings, override: StorageBackend | None = None) -> StorageBackend:
    if override:
        return override
    if settings.storage_mode == "s3":
        if not settings.s3_bucket:
            raise ValueError("S3 bucket must be configured for storage_mode=s3")
        return S3StorageBackend(
            bucket=settings.s3_bucket,
            prefix=settings.storage_prefix,
            region=settings.s3_region,
            endpoint_url=settings.s3_endpoint_url,
        )
    return LocalStorageBackend(base_path=settings.storage_root, base_uri=settings.storage_base_uri)


def create_app(
    settings: Settings | None = None,
    *,
    redis_client=None,
    storage_backend: StorageBackend | None = None,
) -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    app = FastAPI(title="DeepSeek OCR Ingestion API", version="0.1.0")
    resolved_settings = settings or get_settings()

    storage = create_storage_backend(resolved_settings, override=storage_backend)
    queue = TaskQueue(queue_name=resolved_settings.queue_name, redis_url=resolved_settings.redis_url, redis_client=redis_client)
    state = ServiceState(settings=resolved_settings, queue=queue, storage=storage)
    app.state.service = state

    @app.on_event("startup")
    async def startup() -> None:
        await state.queue.connect()
        state.repo = TaskRepository(
            state.queue.redis,
            key_prefix=state.settings.task_status_prefix,
            ttl_seconds=state.settings.task_ttl_seconds,
        )
        await state.storage.connect()
        LOGGER.info(
            "OCR service ready env=%s storage=%s queue=%s",
            state.settings.environment,
            state.settings.storage_mode,
            state.settings.queue_name,
        )

    @app.on_event("shutdown")
    async def shutdown() -> None:
        await state.queue.close()
        await state.storage.close()

    def get_state(request: Request) -> ServiceState:
        return request.app.state.service

    @app.post(
        "/upload",
        response_model=UploadResponse,
        status_code=status.HTTP_202_ACCEPTED,
        summary="Upload a PDF and queue OCR work",
    )
    async def upload_pdf(
        request: Request,
        file: UploadFile = File(...),
        service: ServiceState = Depends(get_state),
    ) -> UploadResponse:
        if not file.filename:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Filename missing")
        if not is_allowed(file.filename, service.settings):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Only PDF uploads are supported",
            )

        now = datetime.now(timezone.utc)
        task_id = uuid4().hex
        key = build_storage_key(
            file.filename,
            prefix=service.settings.storage_prefix,
            task_id=task_id,
            timestamp=now,
        )

        try:
            artifact = await service.storage.save_upload(
                file,
                key=key,
                max_bytes=service.settings.max_pdf_bytes,
            )
        except ValueError as exc:  # file too large
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc)) from exc

        submitter = request.headers.get("X-Submitter") or request.headers.get("X-SME-ID")

        task_record = TaskRecord(
            task_id=task_id,
            filename=file.filename,
            status=TaskStatus.queued,
            content_type=file.content_type or "application/pdf",
            size_bytes=artifact.size_bytes,
            sha256=artifact.sha256,
            storage_uri=artifact.uri,
            storage_path=artifact.path,
            queue_name=service.settings.queue_name,
            submitted_at=now,
            updated_at=now,
            submitted_by=submitter,
        )

        assert service.repo
        await service.repo.save(task_record)

        payload = QueueTask(
            task_id=task_id,
            filename=file.filename,
            content_type=task_record.content_type,
            size_bytes=artifact.size_bytes,
            sha256=artifact.sha256,
            storage_uri=artifact.uri,
            storage_path=artifact.path,
            submitted_at=now,
            submitted_by=submitter,
        )
        await service.queue.enqueue(payload)
        depth = await service.queue.depth()

        status_url = request.url_for("get_status", task_id=task_id)
        return UploadResponse(
            task_id=task_id,
            status=TaskStatus.queued,
            received_bytes=artifact.size_bytes,
            sha256=artifact.sha256,
            storage_uri=artifact.uri,
            queue_depth=depth,
            status_url=str(status_url),
        )

    @app.get("/status/{task_id}", response_model=StatusResponse, name="get_status")
    async def get_status(
        task_id: str,
        service: ServiceState = Depends(get_state),
    ) -> StatusResponse:
        assert service.repo
        record = await service.repo.get(task_id)
        if not record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
        depth = await service.queue.depth()
        return StatusResponse(task=record, queue_depth=depth)

    @app.get("/healthz", response_model=HealthResponse)
    async def health(service: ServiceState = Depends(get_state)) -> HealthResponse:
        await service.queue.health()
        return HealthResponse(status="ok", queue_depth=await service.queue.depth())

    @app.get("/readyz", response_model=ReadyResponse)
    async def ready(service: ServiceState = Depends(get_state)) -> ReadyResponse:
        await service.queue.health()
        try:
            await service.storage.health()
        except Exception as exc:  # pragma: no cover - defensive logging
            LOGGER.exception("Storage health failed: %s", exc)
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Storage unavailable") from exc
        return ReadyResponse(status="ready", queue_depth=await service.queue.depth(), storage_writable=True)

    return app


def is_allowed(filename: str, settings: Settings) -> bool:
    suffix = Path(filename).suffix.lower().lstrip(".")
    return suffix in settings.allowed_extensions


app = create_app()
