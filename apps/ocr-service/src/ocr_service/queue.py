from __future__ import annotations

import logging
from typing import Any

import orjson
from redis.asyncio import Redis, from_url

from .models import QueueTask

LOGGER = logging.getLogger(__name__)


class TaskQueue:
    """Thin wrapper around Redis for queue semantics."""

    def __init__(
        self,
        *,
        queue_name: str,
        redis_url: str | None = None,
        redis_client: Redis | None = None,
    ) -> None:
        if not redis_url and not redis_client:
            raise ValueError("redis_url or redis_client must be provided")
        self.queue_name = queue_name
        self._redis_url = redis_url
        self._redis: Redis | None = redis_client

    async def connect(self) -> None:
        if self._redis is None:
            assert self._redis_url, "redis_url required when client not provided"
            self._redis = from_url(self._redis_url, encoding="utf-8", decode_responses=False)
        await self._redis.ping()
        LOGGER.info("Connected to Redis queue=%s", self.queue_name)

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.close()

    @property
    def redis(self) -> Redis:
        if self._redis is None:
            raise RuntimeError("Redis client not connected yet")
        return self._redis

    async def enqueue(self, payload: QueueTask) -> None:
        message = orjson.dumps(payload.model_dump(mode="json"))
        await self.redis.rpush(self.queue_name, message)
        LOGGER.info("Queued task %s queue_depth=%d", payload.task_id, await self.depth())

    async def depth(self) -> int:
        return int(await self.redis.llen(self.queue_name))

    async def health(self) -> None:
        await self.redis.ping()
