from app.config import Config

def test_defaults():
    cfg = Config.from_env({})
    assert cfg.model_id == "Qwen/Qwen2.5-VL-7B-Instruct"
    assert cfg.inference_timeout_s == 8.0
    assert cfg.warming_retry_after_ms == 45000

def test_env_override():
    cfg = Config.from_env({"VISION_MODEL_ID": "custom/model", "VISION_TIMEOUT_S": "12"})
    assert cfg.model_id == "custom/model"
    assert cfg.inference_timeout_s == 12.0
