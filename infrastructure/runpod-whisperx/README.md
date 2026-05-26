# WhisperX RunPod Serverless worker

Self-hosted alternative to AssemblyAI. Docker image runs Whisper
large-v3-turbo + pyannote 3.1 diarization on RunPod Serverless GPUs.

## Build & push

1. Get a HuggingFace token with read access to `pyannote/speaker-diarization-3.1`
   (accept the model terms first).
2. Build:
   ```
   docker build \
     --build-arg HUGGINGFACE_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
     -t <dockerhub-user>/sales-coach-whisperx:v1.0.0 \
     -t <dockerhub-user>/sales-coach-whisperx:dev \
     infrastructure/runpod-whisperx/
   ```
3. Push to **Docker Hub private repo**:
   ```
   docker login
   docker push <dockerhub-user>/sales-coach-whisperx:v1.0.0
   docker push <dockerhub-user>/sales-coach-whisperx:dev
   ```

## RunPod endpoint setup (one-time per environment)

In the RunPod console → **Serverless** → **+ New Endpoint**:

| Field | Value |
|---|---|
| Container image | `docker.io/<user>/sales-coach-whisperx:dev` (dev) or `:prod` |
| Container registry creds | Add Docker Hub username + access token (saved per account) |
| GPU type | **RTX 4090 (24 GB)** |
| Min workers | `0` (zero idle cost) |
| Max workers | `5` |
| FlashBoot | **On** |
| Idle timeout | `5s` |
| Execution timeout | `1800s` (30 min) |
| Container env | `HF_TOKEN=<the same HF token>` |

Copy the endpoint id into `RUNPOD_ENDPOINT_ID` in the app's env.

## Promotion flow (dev → prod)

- New build → push `:v1.0.x` immutable tag.
- Smoke-test by repointing `:dev` to the new digest, run a known sample
  through `/settings/configuration` with WhisperX selected.
- When happy, retag `:prod` and update the prod RunPod endpoint to pull
  the new tag (RunPod re-pulls on next cold start).

## Local test (optional)

Without RunPod, you can invoke the handler locally:
```
docker run --gpus all --rm -e HF_TOKEN=hf_xxx \
  <user>/sales-coach-whisperx:dev \
  python -c "from handler import handler; \
    print(handler({'input': {'audio_url': 'https://.../sample.mp3'}}))"
```
