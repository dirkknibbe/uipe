from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class Config:
    model_id: str = "Qwen/Qwen2.5-VL-7B-Instruct"
    inference_timeout_s: float = 8.0
    warming_retry_after_ms: int = 45000
    retryable_backoff_ms: int = 1000

    @staticmethod
    def from_env(env: Mapping[str, str]) -> "Config":
        return Config(
            model_id=env.get("VISION_MODEL_ID", Config.model_id),
            inference_timeout_s=float(env.get("VISION_TIMEOUT_S", Config.inference_timeout_s)),
            warming_retry_after_ms=int(env.get("VISION_WARMING_RETRY_MS", Config.warming_retry_after_ms)),
            retryable_backoff_ms=int(env.get("VISION_RETRY_BACKOFF_MS", Config.retryable_backoff_ms)),
        )
