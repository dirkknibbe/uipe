import asyncio
import base64
import io
import threading
from PIL import Image
from app.config import Config

DETECTION_PROMPT = (
    "Detect the UI elements in this screenshot. Return ONLY a JSON array; each item: "
    '{"label": one of [button,input,link,image,text,icon,dropdown,checkbox,radio,tab,other], '
    '"confidence": 0..1, "bbox": {"x","y","w","h"} in pixels, '
    '"text": visible text or null, "is_interactable": bool}. No prose.'
)


class QwenAnalyzer:
    """Lazy-loads Qwen2.5-VL on first construction in a background thread so the
    server can answer /v1/health and return status=warming until ready."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model_id = cfg.model_id
        self._ready = False
        self._model = None
        self._processor = None
        threading.Thread(target=self._load, daemon=True).start()

    @property
    def ready(self) -> bool:
        return self._ready

    def _load(self) -> None:
        import torch
        from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

        self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            self.model_id, torch_dtype=torch.bfloat16, device_map="cuda",
        )  # safetensors by default; if any .bin weights, transformers must use weights_only
        self._processor = AutoProcessor.from_pretrained(self.model_id)
        self._ready = True

    async def infer(self, png_base64: str, regions: list) -> str:
        # Offload the blocking generate() to a thread so the event loop (and the
        # asyncio.wait_for timeout in the handler) stays responsive.
        return await asyncio.to_thread(self._infer_sync, png_base64)

    def _infer_sync(self, png_base64: str) -> str:
        from qwen_vl_utils import process_vision_info

        image = Image.open(io.BytesIO(base64.b64decode(png_base64))).convert("RGB")
        messages = [{"role": "user", "content": [
            {"type": "image", "image": image},
            {"type": "text", "text": DETECTION_PROMPT},
        ]}]
        text = self._processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = self._processor(text=[text], images=image_inputs, videos=video_inputs,
                                 padding=True, return_tensors="pt").to("cuda")
        out = self._model.generate(**inputs, max_new_tokens=1024)
        trimmed = [o[len(i):] for i, o in zip(inputs.input_ids, out)]
        return self._processor.batch_decode(trimmed, skip_special_tokens=True)[0]
