"""
Apple-native equivalent of a CUDA Qwen2.5-VL analyzer, via mlx-vlm.

Replaces:
    Qwen2_5_VLForConditionalGeneration.from_pretrained(
        ..., torch_dtype=bf16, device_map="cuda") + qwen_vl_utils

Install (Apple Silicon only):
    pip install mlx-vlm
Model checkpoint (4-bit, ~6 GB unified memory for 7B):
    mlx-community/Qwen2.5-VL-7B-Instruct-4bit
    (also -8bit, -bf16; 32B and 72B variants exist under mlx-community)

Sources: see the research report. mlx-vlm API verified against
github.com/Blaizzy/mlx-vlm README (June 2026).
"""

from mlx_vlm import load, generate
from mlx_vlm.prompt_utils import apply_chat_template


class MlxQwenAnalyzer:
    """Load once, run many. Mirrors the CUDA analyzer's interface:
    construct -> analyze(image_path, prompt) -> text."""

    def __init__(self, model_id: str = "mlx-community/Qwen2.5-VL-7B-Instruct-4bit"):
        # load() returns (model, processor). Weights land in unified memory;
        # no device_map / .to("cuda") — MLX targets Metal implicitly.
        self.model, self.processor = load(model_id)
        self.config = self.model.config

    def analyze(self, image_path: str, prompt: str, max_tokens: int = 1024) -> str:
        # apply_chat_template wires the image placeholder(s) into the chat format.
        formatted = apply_chat_template(
            self.processor, self.config, prompt, num_images=1
        )
        result = generate(
            self.model,
            self.processor,
            formatted,
            image=[image_path],   # list of paths or PIL images
            max_tokens=max_tokens,
            temperature=0.0,      # deterministic for detection JSON
            verbose=False,
        )
        # generate() returns the decoded string (newer mlx-vlm returns a
        # GenerationResult; use result.text if so).
        return result if isinstance(result, str) else result.text


# --- FastAPI wiring (single-tenant, load model at startup) -------------------
# from fastapi import FastAPI, UploadFile
# app = FastAPI()
# analyzer = MlxQwenAnalyzer()   # loaded once at import/startup
#
# @app.post("/v1/analyze")
# async def analyze(file: UploadFile, prompt: str):
#     tmp = f"/tmp/{file.filename}"
#     with open(tmp, "wb") as f: f.write(await file.read())
#     return {"raw": analyzer.analyze(tmp, prompt)}
#
# NOTE: mlx-vlm also ships a ready-made OpenAI-compatible server, so you may not
# need to hand-roll FastAPI at all:
#   mlx_vlm.server --model mlx-community/Qwen2.5-VL-7B-Instruct-4bit --port 8080
# It exposes /v1/chat/completions (accepts images), /v1/models, /health,
# /unload, plus optional Automatic Prefix Caching (APC_ENABLED=1) and
# --kv-bits KV-cache quantization.
