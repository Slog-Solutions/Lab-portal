# SeamlessStreaming translator (live class translation).
#
# CUDA 12.1 runtime + cuDNN 8 is what the pinned torch 2.1.1 wheel below
# is built against; mixing versions here is the usual cause of "CUDA
# available: False" inside an otherwise healthy container.
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # torch.hub (Silero VAD) resolves from here, so the container needs no
    # internet at runtime — the lab server is air-gapped.
    TORCH_HOME=/models \
    TRANSLATOR_MODEL_DIR=/models

# ffmpeg decodes Translation Lab uploads (mp3/m4a/mp4/whatever a phone
# produced); libsndfile backs soundfile's WAV writing.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.10 python3-pip python3.10-dev \
      ffmpeg libsndfile1 curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/local/bin/python \
    && python -m pip install --upgrade pip setuptools wheel

# Torch first, from the CUDA-matched index. Separate layer: it is ~2GB and
# must not be re-downloaded when requirements.txt changes.
RUN python -m pip install \
      torch==2.1.1 torchaudio==2.1.1 \
      --index-url https://download.pytorch.org/whl/cu121

# fairseq2 ships per-(torch, CUDA, python) wheels on its own index, not
# PyPI — a bare `pip install fairseq2` resolves to something built against
# a different torch and fails at import.
RUN python -m pip install fairseq2==0.2.1 \
      --extra-index-url https://fair.pkg.atmeta.com/fairseq2/whl/pt2.1.1/cu121

# Pinned to a commit, not a branch: the streaming agent class names and
# their args have moved more than once upstream, and this service drives
# them directly.
ARG SEAMLESS_REF=9a081e935c29c6b1e0e05bcbf3fcb623ad306524
RUN python -m pip install \
      "git+https://github.com/facebookresearch/seamless_communication.git@${SEAMLESS_REF}" \
      "simuleval==1.1.4"

COPY services/translator/requirements.txt /app/requirements.txt
RUN python -m pip install -r /app/requirements.txt

COPY services/translator/translator /app/translator
WORKDIR /app

EXPOSE 8080

# Single worker on purpose: the model lives in VRAM once and the
# GpuScheduler serialises work across streams. A second worker would load
# a second 5GB copy of the weights and then contend with the first.
CMD ["python", "-m", "uvicorn", "translator.app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
