"""One screenshot, one hosted backend (optionally two), side by side.

Calls HostedApiAnalyzer directly instead of POSTing /v1/analyze: create_app()
pins an 8s timeout it reads from an empty env (app/main.py:26), and a cold
free-tier endpoint blows through that — a working model would come back as
status=degraded/inference_timeout and read as a failure.

    .venv/bin/python -m bench.smoke_cosmos
    .venv/bin/python -m bench.smoke_cosmos --image ../../landing/screenshots/after-problem.png

Set BASELINE_API_BASE_URL / BASELINE_API_MODEL / BASELINE_API_KEY to also run
the Qwen baseline against the same bytes.
"""
import argparse
import asyncio
import base64
import io
import os
import time
from dataclasses import replace
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

from app.config import Config
from app.hosted import HostedApiAnalyzer
from app.mapping import parse_detection_output

ROOT = Path(__file__).resolve().parents[3]
MAX_B64 = 180 * 1024  # build.nvidia.com inline-image cap; bigger needs NVCF asset upload
DEFAULT_IMAGE = ROOT / "landing/screenshots/after-hero.png"


def encode(path: Path) -> tuple[str, tuple[int, int]]:
    """Downscale (PNG, lossless) until the base64 payload fits the inline cap."""
    im = Image.open(path).convert("RGB")
    for scale in (1.0, 0.75, 0.6, 0.5, 0.4, 0.3):
        size = (int(im.width * scale), int(im.height * scale))
        buf = io.BytesIO()
        im.resize(size, Image.LANCZOS).save(buf, "PNG", optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode()
        if len(b64) <= MAX_B64:
            return b64, size
    raise SystemExit(f"{path.name}: cannot fit under {MAX_B64} bytes as PNG")


async def run(label: str, cfg: Config, b64: str, size: tuple, timeout_s: float, max_tokens: int) -> None:
    print(f"\n--- {label}: {cfg.hosted_model} @ {cfg.hosted_base_url}")
    t0 = time.perf_counter()
    try:
        raw = await HostedApiAnalyzer(cfg, timeout_s=timeout_s, max_tokens=max_tokens).infer(b64, [])
    except Exception as e:
        print(f"  REQUEST FAILED  {type(e).__name__}: {e}")
        return
    ms = (time.perf_counter() - t0) * 1000
    print(f"  latency {ms:.0f}ms  ({'over' if ms > 8000 else 'under'} the 8s handler cap)")
    try:
        els = parse_detection_output(raw)
    except Exception as e:
        print(f"  PARSE FAILED  {type(e).__name__}: {e}\n  raw: {raw[:400]}")
        return
    w, h = size
    oob = [e for e in els if e.bbox.x + e.bbox.w > w or e.bbox.y + e.bbox.h > h
           or e.bbox.x < 0 or e.bbox.y < 0]
    labels = {}
    for e in els:
        labels[e.label] = labels.get(e.label, 0) + 1
    print(f"  {len(els)} elements, {sum(e.is_interactable for e in els)} interactable")
    print(f"  labels: {labels}")
    print(f"  out-of-frame bboxes: {len(oob)}/{len(els)}  (image is {w}x{h})")
    for e in els[:12]:
        print(f"    {e.label:<12} {str(e.bbox):<28} {(e.text or '')[:34]}")
    if len(els) > 12:
        print(f"    … {len(els) - 12} more")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", type=Path, default=DEFAULT_IMAGE)
    ap.add_argument("--timeout", type=float, default=180.0,
                    help="client timeout; detection runs have been seen at 51s")
    ap.add_argument("--max-tokens", type=int, default=4096,
                    help="1024 truncates a full-page array and the parser then rejects everything")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")  # nothing in the service loads it; env vars alone won't reach us
    cfg = Config.from_env(os.environ)
    if not cfg.hosted_api_key:
        raise SystemExit("VISION_API_KEY is empty — check ui-perception-engine/.env")

    b64, size = encode(args.image)
    orig = Image.open(args.image).size
    print(f"{args.image.name}: {orig[0]}x{orig[1]} → {size[0]}x{size[1]}, {len(b64)/1024:.0f}KB base64")

    await run("candidate", cfg, b64, size, args.timeout, args.max_tokens)

    if os.environ.get("BASELINE_API_MODEL"):
        # base_url/key fall back to the candidate's — comparing two models on one
        # provider is the common case; override only for a cross-provider baseline.
        await run("baseline", replace(
            cfg,
            hosted_base_url=os.environ.get("BASELINE_API_BASE_URL", cfg.hosted_base_url),
            hosted_model=os.environ["BASELINE_API_MODEL"],
            hosted_api_key=os.environ.get("BASELINE_API_KEY", cfg.hosted_api_key),
        ), b64, size, args.timeout, args.max_tokens)
    else:
        print("\n(no BASELINE_API_MODEL — candidate only)")


if __name__ == "__main__":
    asyncio.run(main())
