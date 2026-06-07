import json
import re
from app.schema import VisionElement, BBox


class QwenParseError(ValueError):
    """Raised when the model output cannot be parsed into a detection array.
    Surfaced upstream as status=degraded reason=inference_error."""


_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _extract_json_array(text: str) -> str:
    m = _FENCE.search(text)
    if m:
        text = m.group(1)
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise QwenParseError("no JSON array found in model output")
    return text[start : end + 1]


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def parse_qwen_output(text: str) -> list[VisionElement]:
    raw = _extract_json_array(text)
    try:
        items = json.loads(raw)
    except json.JSONDecodeError as e:
        raise QwenParseError(f"invalid JSON: {e}") from e
    if not isinstance(items, list):
        raise QwenParseError("model output is not a JSON array")

    elements: list[VisionElement] = []
    for it in items:
        b = it["bbox"]
        elements.append(
            VisionElement(
                label=str(it["label"]),
                confidence=_clamp(float(it.get("confidence", 0.5)), 0.0, 1.0),
                bbox=BBox(x=float(b["x"]), y=float(b["y"]), w=float(b["w"]), h=float(b["h"])),
                text=it.get("text"),
                is_interactable=it.get("is_interactable"),
                description=it.get("description"),
            )
        )
    return elements
