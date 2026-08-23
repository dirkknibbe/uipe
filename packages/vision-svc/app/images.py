"""Bounded PNG decoding for any analyzer that rasterizes a request.

Pillow will expand a few KB of compressed data into gigabytes of pixels, so
decoding goes through here instead of calling Image.open at the call site.
The size check runs against the header, before any pixel data is decoded.
"""
import base64
import io

from PIL import Image

# Pillow warns past MAX_IMAGE_PIXELS and raises past 2x it. Keep that ceiling
# above our own limit so our check is the one that reports the failure.
Image.MAX_IMAGE_PIXELS = 4096 * 4096
MAX_PIXELS = 3840 * 2160  # 4K


def decode_png(png_base64: str) -> Image.Image:
    """Decode base64 image data to RGB, refusing anything past the pixel ceiling."""
    try:
        raw = base64.b64decode(png_base64, validate=True)
    except Exception as e:
        raise ValueError(f"invalid base64: {e}") from e

    image = Image.open(io.BytesIO(raw))  # lazy: .size reads the header only
    width, height = image.size
    if width * height > MAX_PIXELS:
        raise ValueError(f"image exceeds max dimensions: {width}x{height}")
    return image.convert("RGB")
