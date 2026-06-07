from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator

VisionStatus = Literal["ok", "warming", "degraded"]
VisionReason = Literal["model_loading", "inference_timeout", "inference_error", "unreachable"]


class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class VisionElement(BaseModel):
    label: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: BBox
    text: Optional[str] = None
    is_interactable: Optional[bool] = None
    description: Optional[str] = None


class VisionAnalyzeRequest(BaseModel):
    api_version: Literal["v1"]
    png_base64: str
    regions: list[BBox]
    request_id: Optional[str] = None


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
