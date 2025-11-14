from __future__ import annotations

import hashlib
import io
import logging
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path

import aiofiles
from aiofiles import os as aiofiles_os
import asyncio
import boto3
from fastapi import UploadFile

from .models import StorageArtifact

LOGGER = logging.getLogger(__name__)


class StorageBackend(ABC):
    """Abstract storage interface."""

    @abstractmethod
    async def connect(self) -> None:  # pragma: no cover - interface
        ...

    @abstractmethod
    async def close(self) -> None:  # pragma: no cover - interface
        ...

    @abstractmethod
    async def health(self) -> None:  # pragma: no cover - interface
        ...

    @abstractmethod
    async def save_upload(
        self,
        upload: UploadFile,
        *,
        key: str,
        max_bytes: int,
    ) -> StorageArtifact:
        ...


class LocalStorageBackend(StorageBackend):
    """Store PDFs on a persistent volume mounted inside the pod."""

    def __init__(self, base_path: Path, *, base_uri: str | None = None) -> None:
        self.base_path = base_path
        self.base_uri = base_uri or f"file://{base_path}"

    async def connect(self) -> None:
        self.base_path.mkdir(parents=True, exist_ok=True)
        LOGGER.info("Local storage ready at %s", self.base_path)

    async def close(self) -> None:
        # Nothing to clean up for local paths.
        return None

    async def health(self) -> None:
        test_path = self.base_path / ".healthcheck"
        test_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(test_path, "w") as handle:
            await handle.write("ok")
        await aiofiles_os.remove(test_path)

    async def save_upload(
        self,
        upload: UploadFile,
        *,
        key: str,
        max_bytes: int,
    ) -> StorageArtifact:
        destination = self.base_path / key
        destination.parent.mkdir(parents=True, exist_ok=True)
        sha256 = hashlib.sha256()
        total = 0

        async with aiofiles.open(destination, "wb") as buffer:
            while True:
                chunk = await upload.read(4 * 1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    await upload.close()
                    await buffer.close()
                    await aiofiles_os.remove(destination)
                    raise ValueError("PDF exceeds configured limit")
                sha256.update(chunk)
                await buffer.write(chunk)

        await upload.seek(0)

        return StorageArtifact(
            uri=f"{self.base_uri.rstrip('/')}/{key}",
            path=str(destination),
            size_bytes=total,
            sha256=sha256.hexdigest(),
        )


class S3StorageBackend(StorageBackend):
    """Store PDFs in S3-compatible object storage (R2, MinIO, etc.)."""

    def __init__(
        self,
        *,
        bucket: str,
        prefix: str,
        region: str | None = None,
        endpoint_url: str | None = None,
    ) -> None:
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self._client = boto3.client("s3", region_name=region, endpoint_url=endpoint_url)

    async def connect(self) -> None:
        await asyncio.to_thread(self._client.head_bucket, Bucket=self.bucket)
        LOGGER.info("Connected to bucket %s", self.bucket)

    async def close(self) -> None:
        return None

    async def health(self) -> None:
        await asyncio.to_thread(
            self._client.list_objects_v2, Bucket=self.bucket, MaxKeys=1, Prefix=self.prefix
        )

    async def save_upload(
        self,
        upload: UploadFile,
        *,
        key: str,
        max_bytes: int,
    ) -> StorageArtifact:
        buffer = io.BytesIO()
        sha256 = hashlib.sha256()
        total = 0

        while True:
            chunk = await upload.read(4 * 1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ValueError("PDF exceeds configured limit")
            sha256.update(chunk)
            buffer.write(chunk)

        await upload.seek(0)

        object_key = f"{self.prefix}/{key}".lstrip("/")
        payload = buffer.getvalue()

        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self.bucket,
            Key=object_key,
            Body=payload,
            ContentType=upload.content_type or "application/pdf",
        )

        return StorageArtifact(
            uri=f"s3://{self.bucket}/{object_key}",
            path=object_key,
            size_bytes=total,
            sha256=sha256.hexdigest(),
        )


def build_storage_key(filename: str, *, prefix: str, task_id: str, timestamp: datetime) -> str:
    safe_name = slugify(filename)
    date_prefix = timestamp.strftime("%Y/%m/%d")
    return f"{prefix}/{date_prefix}/{timestamp.strftime('%H%M%S')}-{task_id[:8]}-{safe_name}"


def slugify(filename: str) -> str:
    stem, _, extension = filename.rpartition(".")
    base = stem or filename
    cleaned = "".join(ch if ch.isalnum() else "-" for ch in base).strip("-")
    cleaned = cleaned.lower() or "document"
    suffix = extension.lower() if extension else ""
    if suffix:
        return f"{cleaned}.{suffix}"
    return cleaned
