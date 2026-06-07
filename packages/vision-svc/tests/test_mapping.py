from pathlib import Path
import pytest
from app.mapping import parse_qwen_output, QwenParseError

RAW = Path(__file__).resolve().parent / "fixtures" / "qwen_raw"

def test_parses_bare_json_array():
    els = parse_qwen_output((RAW / "good.txt").read_text())
    assert len(els) == 2
    assert els[0].label == "button"
    assert els[0].is_interactable is True
    assert els[1].bbox.w == 200

def test_parses_fenced_json_with_prose():
    els = parse_qwen_output((RAW / "fenced.txt").read_text())
    assert len(els) == 1
    assert els[0].label == "link"

def test_malformed_output_raises():
    with pytest.raises(QwenParseError):
        parse_qwen_output((RAW / "malformed.txt").read_text())

def test_confidence_clamped_to_unit_range():
    els = parse_qwen_output('[{"label":"x","confidence":1.5,"bbox":{"x":0,"y":0,"w":1,"h":1}}]')
    assert els[0].confidence == 1.0
