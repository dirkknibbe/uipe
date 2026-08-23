import base64
import io

import pytest
from PIL import Image

from app import images


def _png_b64(size=(8, 8)) -> str:
    buf = io.BytesIO()
    Image.new("RGB", size).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_decodes_a_normal_png_to_rgb():
    img = images.decode_png(_png_b64())
    assert img.mode == "RGB"
    assert img.size == (8, 8)


def test_rejects_image_over_the_pixel_ceiling(monkeypatch):
    # Rather than allocate a real 4K bomb, lower the ceiling under a small image.
    monkeypatch.setattr(images, "MAX_PIXELS", 4)
    with pytest.raises(ValueError, match="exceeds max dimensions"):
        images.decode_png(_png_b64((8, 8)))


def test_rejects_invalid_base64():
    with pytest.raises(ValueError, match="invalid base64"):
        images.decode_png("!!!not base64!!!")


def test_rejects_non_image_payload():
    with pytest.raises(Exception):
        images.decode_png(base64.b64encode(b"plain text, not a png").decode())
