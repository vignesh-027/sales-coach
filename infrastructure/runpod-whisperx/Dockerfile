# WhisperX Serverless worker for RunPod.
#
# This image is built locally and pushed to Docker Hub:
#   docker build -t <user>/sales-coach-whisperx:v1.0.0 .
#   docker push <user>/sales-coach-whisperx:v1.0.0
#
# The RunPod Serverless endpoint pulls this image, runs handler.py on each
# job, and returns the diarized transcript in the segment shape that
# services/runpod/fetch-job.ts expects.
#
# Base image: runpod/base ships CUDA + Python preconfigured for the
# Serverless SDK. We bake model weights into the image (large-v3-turbo +
# pyannote 3.1) so cold-starts skip a download.
#
# IMPORTANT: HUGGINGFACE_TOKEN is needed *only* at build time to download
# the pyannote diarization weights (the model card has an accept-terms
# gate). It is NOT needed at runtime. Pass it via:
#   docker build --build-arg HUGGINGFACE_TOKEN=hf_xxx ...

FROM runpod/base:0.6.2-cuda12.1.0

# System deps for audio decoding (ffmpeg) — torchaudio uses libsndfile too.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

# Pin the Python deps. WhisperX 3.x targets torch 2.x.
# pyannote.audio 3.1 is the version WhisperX is tested against.
# runpod is the Serverless handler SDK.
RUN pip install --no-cache-dir \
    runpod==1.7.7 \
    whisperx==3.1.1 \
    pyannote.audio==3.1.1 \
    ctranslate2==4.4.0 \
    faster-whisper==1.0.3 \
    requests==2.32.3

# Pre-fetch the model weights into the image so cold-starts don't pay the
# download cost. The HF token is read from a build arg; the resulting
# files live under /root/.cache/huggingface and torch hub.
ARG HUGGINGFACE_TOKEN
ENV HF_TOKEN=$HUGGINGFACE_TOKEN

WORKDIR /app
COPY download_models.py /app/download_models.py
RUN python /app/download_models.py && unset HUGGINGFACE_TOKEN

COPY handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
