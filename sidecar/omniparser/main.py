"""
OmniParser V2 FastAPI sidecar for UIPE.
Runs alongside the Node/TS MCP server.
Accepts screenshots, returns structured UI element detections.

Force CPU mode (no CUDA on Intel Mac).
"""
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
import uvicorn
from PIL import Image
import hashlib
import io
import os
import pathlib
import torch
from ultralytics import YOLO
from transformers import AutoProcessor, AutoModelForCausalLM
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="OmniParser V2 Sidecar")

# Pillow expands a few KB of compressed data into gigabytes of pixels unless
# bounded. Keep MAX_IMAGE_PIXELS above our own limit so our check reports first.
# Pinned upstream revision. trust_remote_code below executes code fetched from
# this repo, so pinning the revision is what stops a future commit there from
# running here. Re-pin deliberately, never float to main.
FLORENCE_BASE_REVISION = "5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac"

# Loading an ultralytics .pt unpickles it, which executes arbitrary code. Refuse
# anything but the exact reviewed artifact from OmniParser-v2.0's pinned revision.
_YOLO_WEIGHTS = pathlib.Path("weights/icon_detect/model.pt")
_YOLO_SHA256 = "dab3d4351ad00b035db829909a4db98354d5a90f6990e4ac00222a9a95d4bf57"


def _verify_yolo_weights() -> None:
    if not _YOLO_WEIGHTS.exists():
        raise RuntimeError(f"YOLO weights missing at {_YOLO_WEIGHTS}")
    digest = hashlib.sha256(_YOLO_WEIGHTS.read_bytes()).hexdigest()
    if digest != _YOLO_SHA256:
        raise RuntimeError(
            "YOLO weights checksum mismatch — refusing to load. "
            f"expected {_YOLO_SHA256}, got {digest}"
        )


Image.MAX_IMAGE_PIXELS = 4096 * 4096
MAX_PIXELS = 3840 * 2160  # 4K

# Force CPU — no CUDA on this Intel Mac
device = "cpu"

# Models loaded at startup
yolo_model = None
caption_processor = None
caption_model = None


@app.on_event("startup")
async def load_models():
    """Load models at startup with error handling."""
    global yolo_model, caption_processor, caption_model

    logger.info(f"Loading models on device: {device}")

    try:
        # YOLOv8 for element detection
        _verify_yolo_weights()
        yolo_model = YOLO(str(_YOLO_WEIGHTS))
        logger.info("YOLOv8 model loaded")
    except Exception as e:
        logger.error(f"Failed to load YOLOv8 model: {e}")
        raise

    try:
        # Florence-2 for icon captioning
        # Processor from base repo (OmniParser weights don't include tokenizer files)
        # trust_remote_code cannot be dropped here yet: OmniParser's fine-tuned
        # checkpoint declares an inner text_config.model_type of "florence2_language",
        # which transformers' native florence2 implementation does not know
        # (KeyError on load), and native florence2 maps to ImageTextToText rather
        # than CausalLM. Pinning the revision bounds the blast radius until the
        # modeling file is vendored. See the security remediation plan, task 3.3.
        caption_processor = AutoProcessor.from_pretrained(
            "microsoft/Florence-2-base",
            revision=FLORENCE_BASE_REVISION,
            trust_remote_code=True,
        )
        # Model from local fine-tuned weights
        caption_model = AutoModelForCausalLM.from_pretrained(
            "weights/icon_caption_florence",
            trust_remote_code=True
        ).to(device)
        logger.info("Florence-2 caption model loaded")
    except Exception as e:
        logger.error(f"Failed to load Florence-2 model: {e}")
        raise


@app.post("/parse")
async def parse_screenshot(image: UploadFile = File(...)):
    """Parse a UI screenshot into structured elements."""
    if yolo_model is None or caption_model is None:
        raise HTTPException(status_code=503, detail="Models not loaded")

    try:
        img_bytes = await image.read()
        img = Image.open(io.BytesIO(img_bytes))  # lazy: .size reads the header only
        if img.size[0] * img.size[1] > MAX_PIXELS:
            raise ValueError(f"image exceeds max dimensions: {img.size[0]}x{img.size[1]}")
        img = img.convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    # Step 1: Detect interactive elements
    results = yolo_model.predict(img, conf=0.3, iou=0.5)
    detections = []

    for i, box in enumerate(results[0].boxes):
        bbox = box.xyxy[0].tolist()  # [x1, y1, x2, y2]
        conf = box.conf[0].item()
        cls = int(box.cls[0].item())
        label = results[0].names[cls]

        # Step 2: Caption each detected element
        x1, y1, x2, y2 = [int(c) for c in bbox]
        cropped = img.crop((x1, y1, x2, y2))

        caption = None
        try:
            inputs = caption_processor(
                text="<CAPTION>",
                images=cropped,
                return_tensors="pt"
            ).to(device)

            with torch.no_grad():
                output = caption_model.generate(**inputs, max_new_tokens=50)

            caption = caption_processor.decode(output[0], skip_special_tokens=True)
        except Exception as e:
            logger.warning(f"Caption failed for element {i}: {e}")
            caption = None

        detections.append({
            "id": i,
            "label": label,
            "caption": caption,
            "confidence": round(conf, 3),
            "bbox": [round(c, 1) for c in bbox],
            "interactable": label in [
                "button", "input", "link", "checkbox",
                "radio", "select", "toggle", "icon"
            ],
            "text": None  # OCR would fill this
        })

    return JSONResponse(content={"elements": detections})


@app.get("/health")
async def health():
    """Health check endpoint."""
    models_loaded = yolo_model is not None and caption_model is not None
    return {
        "status": "ok" if models_loaded else "loading",
        "device": device,
        "models_loaded": models_loaded
    }


if __name__ == "__main__":
    # Loopback by default. The sidecar has no auth of its own, so binding it
    # off-host has to be a deliberate opt-in rather than the default.
    host = os.environ.get("OMNIPARSER_HOST", "127.0.0.1")
    port = int(os.environ.get("OMNIPARSER_PORT", "8100"))
    uvicorn.run(app, host=host, port=port)
