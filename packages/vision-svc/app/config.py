from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class Config:
    model_id: str = "Qwen/Qwen2.5-VL-7B-Instruct"
    inference_timeout_s: float = 8.0
    warming_retry_after_ms: int = 45000
    retryable_backoff_ms: int = 1000
    # Hosted-API backend (VISION_BACKEND=hosted): an OpenAI-compatible VLM endpoint
    # (Hyperbolic/DeepInfra/OpenRouter). Used by HostedApiAnalyzer; ignored by QwenAnalyzer.
    hosted_base_url: str = "https://api.hyperbolic.xyz/v1"
    hosted_api_key: str = ""
    hosted_model: str = "Qwen/Qwen2.5-VL-7B-Instruct"

    @staticmethod
    def from_env(env: Mapping[str, str]) -> "Config":
        return Config(
            model_id=env.get("VISION_MODEL_ID", Config.model_id),
            inference_timeout_s=float(env.get("VISION_TIMEOUT_S", Config.inference_timeout_s)),
            warming_retry_after_ms=int(env.get("VISION_WARMING_RETRY_MS", Config.warming_retry_after_ms)),
            retryable_backoff_ms=int(env.get("VISION_RETRY_BACKOFF_MS", Config.retryable_backoff_ms)),
            hosted_base_url=env.get("VISION_API_BASE_URL", Config.hosted_base_url),
            hosted_api_key=env.get("VISION_API_KEY", Config.hosted_api_key),
            hosted_model=env.get("VISION_API_MODEL", Config.hosted_model),
        )
