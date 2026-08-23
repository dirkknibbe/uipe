import math
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

# A 1280x720 lossless PNG sits far under 4 MB, so a 16 MB base64 ceiling leaves
# 4K headroom while still bounding what one request can make us allocate.
MAX_PNG_BASE64 = 16_000_000
MAX_REGIONS = 64
MAX_REQUEST_ID = 200

VisionStatus = Literal["ok", "warming", "degraded"]
VisionReason = Literal["model_loading", "inference_timeout", "inference_error", "unreachable"]


class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float

    @field_validator("x", "y", "w", "h")
    @classmethod
    def _finite(cls, v: float) -> float:
        # inf/nan propagate silently through downstream geometry instead of failing
        if not math.isfinite(v):
            raise ValueError("coordinate must be finite")
        return v


class VisionElement(BaseModel):
    label: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: BBox
    text: Optional[str] = None
    is_interactable: Optional[bool] = None
    description: Optional[str] = None


class VisionAnalyzeRequest(BaseModel):
    api_version: Literal["v1"]
    png_base64: str = Field(max_length=MAX_PNG_BASE64)
    regions: list[BBox] = Field(max_length=MAX_REGIONS)
    request_id: Optional[str] = Field(default=None, max_length=MAX_REQUEST_ID)


class VisionAnalyzeResponse(BaseModel):
    api_version: Literal["v1"] = "v1"
    request_id: str
    status: VisionStatus
    elements: list[VisionElement]
    model_id: str
    latency_ms: float
    reason: Optional[VisionReason] = None
    retry_after_ms: Optional[int] = None
    message: Optional[str] = None

    @model_validator(mode="after")
    def _reason_required_when_not_ok(self):
        if self.status != "ok" and self.reason is None:
            raise ValueError("reason is required when status is not ok")
        return self


class VisionError(BaseModel):
    api_version: Literal["v1"] = "v1"
    request_id: str
    error: dict  # {"code": str, "message": str}
