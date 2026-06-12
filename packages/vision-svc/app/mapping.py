import json
import re
from app.schema import VisionElement, BBox


class DetectionParseError(ValueError):
    """Raised when the model output cannot be parsed into a detection array.
    Surfaced upstream as status=degraded reason=inference_error."""


_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _extract_json_array(text: str) -> str:
    m = _FENCE.search(text)
    if m:
        text = m.group(1)
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise DetectionParseError("no JSON array found in model output")
    return text[start : end + 1]


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# vsv-4: model output is untrusted. Constrain labels to a known set and cap sizes
# so a hostile/compromised model can't inject arbitrary strings or flood the
# consumer with elements.
_LABELS = {"button", "input", "link", "image", "text", "icon", "dropdown", "checkbox", "radio", "tab", "other"}
_MAX_ELEMENTS = 256
_MAX_TEXT_LENGTH = 512


def _cap(s, n):
    return s[:n] if isinstance(s, str) else s


def parse_detection_output(text: str) -> list[VisionElement]:
    raw = _extract_json_array(text)
    try:
        items = json.loads(raw)
    except json.JSONDecodeError as e:
        raise DetectionParseError(f"invalid JSON: {e}") from e
    if not isinstance(items, list):
        raise DetectionParseError("model output is not a JSON array")

    elements: list[VisionElement] = []
    for it in items[:_MAX_ELEMENTS]:
        b = it["bbox"]
        label = str(it["label"]).strip().lower()
        if label not in _LABELS:
            label = "other"
        is_interactable = it.get("is_interactable")
        elements.append(
            VisionElement(
                label=label,
                confidence=_clamp(float(it.get("confidence", 0.5)), 0.0, 1.0),
                bbox=BBox(x=float(b["x"]), y=float(b["y"]), w=float(b["w"]), h=float(b["h"])),
                text=_cap(it.get("text"), _MAX_TEXT_LENGTH),
                is_interactable=is_interactable if isinstance(is_interactable, bool) else None,
                description=_cap(it.get("description"), _MAX_TEXT_LENGTH),
            )
        )
    return elements
