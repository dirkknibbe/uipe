import asyncio
import logging
import time
import uuid
from typing import Protocol

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import Config
from app.mapping import parse_detection_output
from app.schema import VisionAnalyzeRequest, VisionAnalyzeResponse

log = logging.getLogger("vision-svc")


class Analyzer(Protocol):
    model_id: str
    @property
    def ready(self) -> bool: ...
    async def infer(self, png_base64: str, regions: list) -> str: ...


def create_app(analyzer: Analyzer, timeout_s: float | None = None) -> FastAPI:
    cfg = Config.from_env({})
    timeout = timeout_s if timeout_s is not None else cfg.inference_timeout_s
    app = FastAPI(title="uipe-vision-svc")

    @app.exception_handler(RequestValidationError)
    async def _on_validation_error(request: Request, exc: RequestValidationError):
        rid = (request.headers.get("x-request-id") or str(uuid.uuid4()))
        return JSONResponse(
            status_code=422,
            content={"api_version": "v1", "request_id": rid,
                     "error": {"code": "invalid_request", "message": str(exc.errors())}},
        )

    @app.get("/v1/health")
    async def health():
        return {"ready": analyzer.ready, "model_id": analyzer.model_id}

    @app.post("/v1/analyze")
    async def analyze(req: VisionAnalyzeRequest) -> VisionAnalyzeResponse:
        rid = req.request_id or str(uuid.uuid4())

        if not analyzer.ready:
            return VisionAnalyzeResponse(
                request_id=rid, status="warming", elements=[], model_id=analyzer.model_id,
                latency_ms=0.0, reason="model_loading", retry_after_ms=cfg.warming_retry_after_ms,
            )

        t0 = time.perf_counter()
        elapsed = lambda: (time.perf_counter() - t0) * 1000.0
        try:
            raw = await asyncio.wait_for(
                analyzer.infer(req.png_base64, req.regions), timeout=timeout
            )
            elements = parse_detection_output(raw)
            return VisionAnalyzeResponse(
                request_id=rid, status="ok", elements=elements,
                model_id=analyzer.model_id, latency_ms=elapsed(),
            )
        except asyncio.TimeoutError:
            return VisionAnalyzeResponse(
                request_id=rid, status="degraded", elements=[], model_id=analyzer.model_id,
                latency_ms=elapsed(), reason="inference_timeout", retry_after_ms=cfg.retryable_backoff_ms,
                message=f"inference exceeded {timeout}s",
            )
        except Exception as e:  # honest catch-all; raw detail to logs, opaque message on the wire
            log.exception("inference failed", extra={"request_id": rid})
            return VisionAnalyzeResponse(
                request_id=rid, status="degraded", elements=[], model_id=analyzer.model_id,
                latency_ms=elapsed(), reason="inference_error", message=f"{type(e).__name__}: {e}",
            )

    return app


def build_default_app() -> FastAPI:
    import os

    cfg = Config.from_env(os.environ)
    backend = os.environ.get("VISION_BACKEND", "qwen")
    if backend == "hosted":
        from app.hosted import HostedApiAnalyzer  # no torch — runs anywhere

        return create_app(HostedApiAnalyzer(cfg))
    from app.qwen import QwenAnalyzer

    return create_app(QwenAnalyzer(cfg))


# uvicorn entrypoint: `uvicorn app.main:app`
# NB: intentionally NO module-level `app = ...` global here. PEP 562 module
# __getattr__ only fires for names not found by normal lookup; defining `app`
# would shadow this hook and uvicorn would import that value instead of building
# the app. Leaving `app` undefined makes access lazily build it (and keeps torch
# out of the import path during unit tests).
def __getattr__(name):  # module-level lazy attribute (PEP 562)
    if name == "app":
        return build_default_app()
    raise AttributeError(name)
