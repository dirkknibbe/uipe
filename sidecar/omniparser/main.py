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
import io
import torch
from ultralytics import YOLO
from transformers import AutoProcessor, AutoModelForCausalLM
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="OmniParser V2 Sidecar")

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
        yolo_model = YOLO("weights/icon_detect/model.pt")
        logger.info("YOLOv8 model loaded")
    except Exception as e:
        logger.error(f"Failed to load YOLOv8 model: {e}")
        raise

    try:
        # Florence-2 for icon captioning
        # Processor from base repo (OmniParser weights don't include tokenizer files)
        caption_processor = AutoProcessor.from_pretrained(
            "microsoft/Florence-2-base",
            trust_remote_code=True
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
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
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
    uvicorn.run(app, host="0.0.0.0", port=8100)
