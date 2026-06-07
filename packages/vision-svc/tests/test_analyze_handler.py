import asyncio
import pytest
from fastapi.testclient import TestClient
from app.main import create_app, Analyzer

class FakeAnalyzer(Analyzer):
    def __init__(self, ready=True, model_id="fake-model", behavior="ok"):
        self._ready = ready
        self.model_id = model_id
        self.behavior = behavior  # "ok" | "timeout" | "error"
    @property
    def ready(self): return self._ready
    async def infer(self, png_base64, regions):
        if self.behavior == "timeout":
            await asyncio.sleep(10)  # exceeds the test timeout
        if self.behavior == "error":
            raise RuntimeError("boom")
        return '[{"label":"button","confidence":0.9,"bbox":{"x":1,"y":2,"w":3,"h":4}}]'

def _client(analyzer, timeout_s=0.05):
    return TestClient(create_app(analyzer, timeout_s=timeout_s))

REQ = {"api_version": "v1", "png_base64": "AAAA", "regions": []}

def test_ok_path():
    r = _client(FakeAnalyzer()).post("/v1/analyze", json=REQ)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["elements"][0]["label"] == "button"
    assert body["request_id"]  # generated when absent

def test_warming_when_model_not_ready():
    r = _client(FakeAnalyzer(ready=False)).post("/v1/analyze", json=REQ)
    body = r.json()
    assert body["status"] == "warming"
    assert body["reason"] == "model_loading"
    assert body["elements"] == []
    assert body["retry_after_ms"] > 0

def test_degraded_on_timeout():
    r = _client(FakeAnalyzer(behavior="timeout"), timeout_s=0.05).post("/v1/analyze", json=REQ)
    body = r.json()
    assert body["status"] == "degraded"
    assert body["reason"] == "inference_timeout"

def test_degraded_on_inference_error_carries_opaque_message():
    r = _client(FakeAnalyzer(behavior="error")).post("/v1/analyze", json=REQ)
    body = r.json()
    assert body["status"] == "degraded"
    assert body["reason"] == "inference_error"
    assert "RuntimeError" in body["message"]

def test_echoes_caller_request_id():
    r = _client(FakeAnalyzer()).post("/v1/analyze", json={**REQ, "request_id": "caller-xyz"})
    assert r.json()["request_id"] == "caller-xyz"

def test_health_reports_readiness():
    assert _client(FakeAnalyzer(ready=True)).get("/v1/health").json()["ready"] is True
    assert _client(FakeAnalyzer(ready=False)).get("/v1/health").json()["ready"] is False

def test_malformed_request_returns_4xx_vision_error():
    r = _client(FakeAnalyzer()).post("/v1/analyze", json={"api_version": "v2", "png_base64": "x", "regions": []})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_request"
