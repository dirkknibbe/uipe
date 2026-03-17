# OmniParser V2 Sidecar

FastAPI server that runs OmniParser V2 (YOLOv8 + Florence-2) for UI element detection and captioning. Called by the UIPE TypeScript MCP server via HTTP.

## Setup

### 1. Create Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Install dependencies

For CPU-only (Intel Mac):

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

For GPU (NVIDIA with CUDA):

```bash
pip install -r requirements.txt
```

### 3. Download model weights

```bash
# Create weights directory
mkdir -p weights/icon_detect weights/icon_caption_florence

# Download from HuggingFace (microsoft/OmniParser-v2.0)
huggingface-cli download microsoft/OmniParser-v2.0 --local-dir weights/
```

The weights directory should look like:

```
weights/
  icon_detect/
    model.pt
  icon_caption_florence/
    config.json
    model.safetensors
    ...
```

### 4. Run

```bash
source .venv/bin/activate
python main.py
```

The server starts on `http://localhost:8100`.

### Endpoints

- **POST `/parse`** -- Upload a screenshot, get back detected UI elements with labels, captions, bounding boxes, and interactability flags.
- **GET `/health`** -- Returns server status, device info, and model load state.
