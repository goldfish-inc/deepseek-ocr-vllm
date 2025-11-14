from __future__ import annotations

from pathlib import Path

import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient

from ocr_service.app import create_app
from ocr_service.config import Settings
from ocr_service.storage import LocalStorageBackend


@pytest.fixture()
def client(tmp_path: Path):
    redis = fakeredis.aioredis.FakeRedis(decode_responses=False)
    storage_root = tmp_path / "inbox"
    settings = Settings(
        redis_url="redis://unused",
        queue_name="test:queue",
        storage_root=storage_root,
        storage_prefix="tests",
        storage_mode="local",
    )
    storage = LocalStorageBackend(base_path=storage_root, base_uri="file://tests")
    app = create_app(settings=settings, redis_client=redis, storage_backend=storage)
    with TestClient(app) as test_client:
        yield test_client


def test_upload_and_status_flow(client):
    test_client = client
    pdf_bytes = b"%PDF-1.4 test\n%%EOF"
    response = test_client.post(
        "/upload",
        files={"file": ("unit.pdf", pdf_bytes, "application/pdf")},
        headers={"X-Submitter": "sme@example.org"},
    )
    assert response.status_code == 202
    payload = response.json()
    task_id = payload["task_id"]
    assert payload["status"] == "queued"
    assert payload["received_bytes"] == len(pdf_bytes)
    assert payload["queue_depth"] == 1

    status_response = test_client.get(f"/status/{task_id}")
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["task"]["filename"] == "unit.pdf"
    assert status_payload["queue_depth"] == 1


def test_rejects_non_pdf(client):
    test_client = client
    response = test_client.post(
        "/upload",
        files={"file": ("notes.txt", b"text", "text/plain")},
    )
    assert response.status_code == 415
    assert response.json()["detail"] == "Only PDF uploads are supported"


def test_health_endpoints(client):
    test_client = client
    resp = test_client.get("/healthz")
    assert resp.status_code == 200
    ready = test_client.get("/readyz")
    assert ready.status_code == 200
