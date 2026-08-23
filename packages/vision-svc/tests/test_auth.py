"""Optional bearer auth on /v1/analyze (vsv-6). Phase-4 gate, seeded early."""
from fastapi.testclient import TestClient

from app.main import create_app

_REQ = {"api_version": "v1", "png_base64": "aaaa", "regions": []}


class _Stub:
    model_id = "stub"

    @property
    def ready(self):
        return True

    async def infer(self, png_base64, regions):
        return "[]"


def _client():
    return TestClient(create_app(_Stub()))


def test_rejects_missing_header_when_token_set(monkeypatch):
    monkeypatch.setenv("VISION_SVC_TOKEN", "secret")
    assert _client().post("/v1/analyze", json=_REQ).status_code == 401


def test_rejects_wrong_token(monkeypatch):
    monkeypatch.setenv("VISION_SVC_TOKEN", "secret")
    resp = _client().post(
        "/v1/analyze", headers={"Authorization": "Bearer wrong"}, json=_REQ
    )
    assert resp.status_code == 401


def test_accepts_correct_token(monkeypatch):
    monkeypatch.setenv("VISION_SVC_TOKEN", "secret")
    resp = _client().post(
        "/v1/analyze", headers={"Authorization": "Bearer secret"}, json=_REQ
    )
    assert resp.status_code == 200


def test_open_when_no_token_configured(monkeypatch):
    # Back-compat: purely local single-tenant use stays unauthenticated.
    monkeypatch.delenv("VISION_SVC_TOKEN", raising=False)
    assert _client().post("/v1/analyze", json=_REQ).status_code == 200


def test_health_stays_open_for_probes(monkeypatch):
    monkeypatch.setenv("VISION_SVC_TOKEN", "secret")
    assert _client().get("/v1/health").status_code == 200
