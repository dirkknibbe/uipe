from bench.scoring import iou, interactable_recall

def test_iou_identical_boxes_is_one():
    b = {"x": 0, "y": 0, "w": 10, "h": 10}
    assert iou(b, b) == 1.0

def test_iou_disjoint_boxes_is_zero():
    assert iou({"x": 0, "y": 0, "w": 10, "h": 10}, {"x": 100, "y": 100, "w": 10, "h": 10}) == 0.0

def test_iou_half_overlap():
    a = {"x": 0, "y": 0, "w": 10, "h": 10}
    b = {"x": 5, "y": 0, "w": 10, "h": 10}
    assert abs(iou(a, b) - (50 / 150)) < 1e-6  # inter=50, union=150

def test_interactable_recall_matches_by_label_and_iou():
    expected = [
        {"label": "button", "is_interactable": True, "bbox": {"x": 0, "y": 0, "w": 10, "h": 10}},
        {"label": "input", "is_interactable": True, "bbox": {"x": 50, "y": 0, "w": 20, "h": 10}},
    ]
    detected = [
        {"label": "button", "bbox": {"x": 1, "y": 1, "w": 10, "h": 10}},   # matches button (IoU>0.5)
        {"label": "link", "bbox": {"x": 50, "y": 0, "w": 20, "h": 10}},    # wrong label for the input
    ]
    assert interactable_recall(detected, expected, iou_threshold=0.5) == 0.5

def test_interactable_recall_no_expected_is_one():
    assert interactable_recall([], [], iou_threshold=0.5) == 1.0
