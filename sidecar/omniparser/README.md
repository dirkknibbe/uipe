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
# Pinned revision: the sidecar unpickles these weights, so the artifact must be
# the exact one that was reviewed. Do not drop --revision.
huggingface-cli download microsoft/OmniParser-v2.0 \
  --revision 6600256cb0f1b07651e3bc86166196307bad7e2d \
  --local-dir weights/
```

`main.py` verifies the YOLO checkpoint at startup and refuses to load on a
mismatch:

| File | SHA-256 |
|---|---|
| `weights/icon_detect/model.pt` | `dab3d4351ad00b035db829909a4db98354d5a90f6990e4ac00222a9a95d4bf57` |

If you re-pin to a newer revision, update `_YOLO_SHA256` in `main.py` in the
same commit, and say why in the message.

The Florence-2 processor is pinned to revision
`5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac`. That call still passes
`trust_remote_code=True` — see the comment in `main.py` for why it cannot be
dropped for this checkpoint yet.

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
