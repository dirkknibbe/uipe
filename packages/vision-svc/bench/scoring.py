def iou(a: dict, b: dict) -> float:
    ax2, ay2 = a["x"] + a["w"], a["y"] + a["h"]
    bx2, by2 = b["x"] + b["w"], b["y"] + b["h"]
    ix1, iy1 = max(a["x"], b["x"]), max(a["y"], b["y"])
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter == 0.0:
        return 0.0
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union


def interactable_recall(detected: list, expected: list, iou_threshold: float) -> float:
    """Fraction of expected interactable elements matched by a detection with the
    same label and IoU >= threshold. Returns 1.0 when nothing is expected."""
    wanted = [e for e in expected if e.get("is_interactable")]
    if not wanted:
        return 1.0
    matched = 0
    used = set()
    for exp in wanted:
        for i, det in enumerate(detected):
            if i in used:
                continue
            if det["label"] == exp["label"] and iou(det["bbox"], exp["bbox"]) >= iou_threshold:
                matched += 1
                used.add(i)
                break
    return matched / len(wanted)
