from __future__ import annotations

import logging
from datetime import datetime

import orjson
from redis.asyncio import Redis

from .models import TaskRecord, TaskStatus

LOGGER = logging.getLogger(__name__)


class TaskRepository:
    """Stores task metadata in Redis for quick status lookups."""

    def __init__(self, redis: Redis, *, key_prefix: str, ttl_seconds: int) -> None:
        self.redis = redis
        self.key_prefix = key_prefix
        self.ttl_seconds = ttl_seconds

    def _key(self, task_id: str) -> str:
        return f"{self.key_prefix}{task_id}"

    async def save(self, record: TaskRecord) -> None:
        payload = orjson.dumps(record.model_dump(mode="json"))
        key = self._key(record.task_id)
        await self.redis.set(key, payload, ex=self.ttl_seconds)
        LOGGER.debug("Stored task metadata task_id=%s", record.task_id)

    async def get(self, task_id: str) -> TaskRecord | None:
        raw = await self.redis.get(self._key(task_id))
        if not raw:
            return None
        data = orjson.loads(raw)
        return TaskRecord.model_validate(data)

    async def update_status(
        self,
        task_id: str,
        status: TaskStatus,
        *,
        error_message: str | None = None,
        retry_count: int | None = None,
    ) -> TaskRecord | None:
        record = await self.get(task_id)
        if not record:
            return None
        record.status = status
        record.updated_at = datetime.utcnow()
        if error_message is not None:
            record.error_message = error_message
        if retry_count is not None:
            record.retry_count = retry_count
        await self.save(record)
        return record
