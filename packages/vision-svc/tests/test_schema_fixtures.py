import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from app.schema import VisionAnalyzeRequest, VisionAnalyzeResponse

FIX = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "v1"

def _load(name): return json.loads((FIX / name).read_text())

def test_valid_request_fixture():
    VisionAnalyzeRequest.model_validate(_load("analyze.request.json"))

@pytest.mark.parametrize("name", [
    "analyze.response.ok.json",
    "analyze.response.warming.json",
    "analyze.response.degraded.json",
])
def test_valid_response_fixtures(name):
    VisionAnalyzeResponse.model_validate(_load(name))

def test_invalid_response_missing_reason_rejected():
    with pytest.raises(ValidationError):
        VisionAnalyzeResponse.model_validate(_load("analyze.response.invalid-missing-reason.json"))

def test_invalid_request_bad_version_rejected():
    with pytest.raises(ValidationError):
        VisionAnalyzeRequest.model_validate(_load("analyze.request.invalid-bad-version.json"))
