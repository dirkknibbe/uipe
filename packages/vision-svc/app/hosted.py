import httpx

from app.config import Config
from app.prompt import DETECTION_PROMPT


class HostedApiAnalyzer:
    """Analyzer backed by an OpenAI-compatible hosted VLM API (Hyperbolic /
    DeepInfra / OpenRouter). Implements the same duck-typed Analyzer protocol as
    QwenAnalyzer, so it drops into create_app() unchanged. No GPU, no warmup — it
    runs anywhere (including the Intel Mac), which is why it's the test-today path.
    The model's raw text is returned verbatim; the handler's parse_detection_output
    turns it into /v1 elements, so the contract + mapping are fully reused.
    """

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model_id = cfg.hosted_model
        self._base_url = cfg.hosted_base_url.rstrip("/")
        self._api_key = cfg.hosted_api_key

    @property
    def ready(self) -> bool:
        return True  # a hosted API has no local warmup phase

    async def infer(self, png_base64: str, regions: list) -> str:
        payload = {
            "model": self.model_id,
            "temperature": 0,
            "max_tokens": 1024,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{png_base64}"},
                        },
                        {"type": "text", "text": DETECTION_PROMPT},
                    ],
                }
            ],
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{self._base_url}/chat/completions", json=payload, headers=headers
            )
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]
