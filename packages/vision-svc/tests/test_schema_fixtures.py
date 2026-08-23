import base64
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


# --- Track 3 / Task 3.2: request size caps (vsv-1, vsv-2, vsv-3) ---

def test_png_base64_size_capped():
    huge = base64.b64encode(b"\x00" * (20 * 1024 * 1024)).decode()
    with pytest.raises(ValidationError):
        VisionAnalyzeRequest(api_version="v1", png_base64=huge, regions=[])


def test_regions_count_capped():
    with pytest.raises(ValidationError):
        VisionAnalyzeRequest(
            api_version="v1", png_base64="aaaa",
            regions=[{"x": 0, "y": 0, "w": 1, "h": 1}] * 1000,
        )


def test_bbox_rejects_non_finite_coords():
    with pytest.raises(ValidationError):
        VisionAnalyzeRequest(
            api_version="v1", png_base64="aaaa",
            regions=[{"x": float("inf"), "y": 0, "w": 1, "h": 1}],
        )


def test_request_id_length_capped():
    with pytest.raises(ValidationError):
        VisionAnalyzeRequest(
            api_version="v1", png_base64="aaaa", regions=[], request_id="x" * 500,
        )


def test_normal_request_still_accepted():
    req = VisionAnalyzeRequest(
        api_version="v1", png_base64="aaaa",
        regions=[{"x": 0, "y": 0, "w": 10, "h": 10}], request_id="abc",
    )
    assert len(req.regions) == 1
