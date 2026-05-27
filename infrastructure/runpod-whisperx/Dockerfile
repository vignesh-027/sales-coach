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
# IMPORTANT: HuggingFace_Token is needed *only* at build time to download
# the pyannote diarization weights (the model card has an accept-terms
# gate). It is NOT needed at runtime. Pass it via:
#   docker build --build-arg HuggingFace_Token=hf_xxx ...

FROM runpod/base:0.6.2-cuda12.1.0

# System deps for audio decoding (ffmpeg) — torchaudio uses libsndfile too.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

# Pin the Python deps. WhisperX 3.x targets torch 2.x.
# pyannote.audio 3.1 is the version WhisperX is tested against.
# runpod is the Serverless handler SDK.
# We only pin the *direct* deps we actually call. Pip resolves torch,
# torchaudio, pyannote.audio, ctranslate2, faster-whisper transitively
# from whisperx 3.8.6. Over-pinning here is what kept breaking the build
# (whisperx 3.1.1 hard-pinned pyannote.audio==3.1.1, which in turn calls
# the removed torchaudio.set_audio_backend API).
RUN python3 -m pip install --no-cache-dir \
    runpod==1.7.7 \
    whisperx==3.8.6 \
    requests==2.32.3 \
    hf_transfer==0.1.8

# Pre-fetch the model weights into the image so cold-starts don't pay the
# download cost. The HF token is read from a build arg; the resulting
# files live under /root/.cache/huggingface and torch hub.
ARG HuggingFace_Token
ENV HuggingFace_Token=$HuggingFace_Token

WORKDIR /app
COPY download_models.py /app/download_models.py
RUN python3 /app/download_models.py && unset HuggingFace_Token

COPY handler.py /app/handler.py

CMD ["python3", "-u", "/app/handler.py"]
