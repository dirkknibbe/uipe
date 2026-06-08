import asyncio

import app.hosted as hosted
from app.config import Config
from app.hosted import HostedApiAnalyzer
from app.mapping import parse_qwen_output


class _FakeResponse:
    def __init__(self, content: str):
        self._content = content

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


class _FakeAsyncClient:
    """Stand-in for httpx.AsyncClient that records the request and returns a
    canned chat-completions response — no network."""

    captured: dict = {}

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, json, headers):
        _FakeAsyncClient.captured = {"url": url, "json": json, "headers": headers}
        return _FakeResponse(
            '[{"label":"button","confidence":0.9,"bbox":{"x":1,"y":2,"w":3,"h":4}}]'
        )


def test_hosted_ready_is_true_without_warmup():
    assert HostedApiAnalyzer(Config.from_env({})).ready is True


def test_hosted_config_env_overrides():
    cfg = Config.from_env(
        {"VISION_API_BASE_URL": "https://x/v1", "VISION_API_KEY": "k", "VISION_API_MODEL": "m"}
    )
    assert cfg.hosted_base_url == "https://x/v1"
    assert cfg.hosted_api_key == "k"
    assert cfg.hosted_model == "m"


def test_hosted_infer_builds_openai_vision_request_and_extracts_content(monkeypatch):
    monkeypatch.setattr(hosted.httpx, "AsyncClient", _FakeAsyncClient)
    cfg = Config.from_env(
        {"VISION_API_BASE_URL": "https://x/v1", "VISION_API_KEY": "secret", "VISION_API_MODEL": "qwen-vl"}
    )
    analyzer = HostedApiAnalyzer(cfg)

    raw = asyncio.run(analyzer.infer("BASE64PNG", []))

    cap = _FakeAsyncClient.captured
    # endpoint + auth
    assert cap["url"] == "https://x/v1/chat/completions"
    assert cap["headers"]["Authorization"] == "Bearer secret"
    # model + the image embedded as a base64 data URL + the detection prompt
    assert cap["json"]["model"] == "qwen-vl"
    content = cap["json"]["messages"][0]["content"]
    assert any(
        p.get("type") == "image_url" and "BASE64PNG" in p["image_url"]["url"] for p in content
    )
    assert any(p.get("type") == "text" and "JSON array" in p["text"] for p in content)
    # the returned text flows through the SAME mapping the GPU path uses
    elements = parse_qwen_output(raw)
    assert elements[0].label == "button"


def test_hosted_trailing_slash_base_url_is_normalized(monkeypatch):
    monkeypatch.setattr(hosted.httpx, "AsyncClient", _FakeAsyncClient)
    cfg = Config.from_env({"VISION_API_BASE_URL": "https://x/v1/", "VISION_API_KEY": "k"})
    asyncio.run(HostedApiAnalyzer(cfg).infer("AAAA", []))
    assert _FakeAsyncClient.captured["url"] == "https://x/v1/chat/completions"
