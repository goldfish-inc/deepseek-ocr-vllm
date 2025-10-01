import json as pyjson
import types
import numpy as np
import pytest
from fastapi.testclient import TestClient

import adapter.app as app_mod

app = app_mod.app
client = TestClient(app)


class DummyResp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {"outputs": [{"name": "logits", "data": [[0.1, 0.9]]}]}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception("HTTP error")

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def mock_httpx(monkeypatch):
    async def fake_post(self, url, json):
        return DummyResp()

    class DummyClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        post = fake_post

    monkeypatch.setattr(app_mod, "httpx", types.SimpleNamespace(AsyncClient=DummyClient))


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_predict_classification(monkeypatch):
    # Mock tokenizer to avoid HF download
    class DummyTok:
        def __call__(self, text, return_tensors=None, max_length=None, truncation=None):
            arr = np.array([[1, 2, 3]], dtype=np.int64)
            return {"input_ids": arr, "attention_mask": arr}
    monkeypatch.setattr(app_mod, "_tok", DummyTok())

    payload = {"model": "bert-base-uncased", "task": "classification", "text": "foo"}
    r = client.post("/predict", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert "top_class" in body and "confidence" in body


def test_predict_bytes_inputs(monkeypatch):
    payload = {"model": "docling-granite-python", "pdf_base64": "", "prompt": "extract"}
    r = client.post("/predict", json=payload)
    # Should 400 on invalid base64
    assert r.status_code == 400
