FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3-pip git && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
# CUDA torch wheel + model libs (pinned at build; these are Linux/CUDA, free of the Mac 2.2.2 pin)
RUN pip3 install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu124 \
 && pip3 install --no-cache-dir "transformers>=4.49,<5" accelerate qwen-vl-utils \
 && pip3 install --no-cache-dir -r requirements.txt

COPY app ./app
ENV VISION_MODEL_ID=Qwen/Qwen2.5-VL-7B-Instruct
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
