"""RunPod Serverless entrypoint for WhisperX transcription + diarization.

Job input (matches services/runpod/submit.ts):
    {
      "audio_url": "https://...",
      "diarize": true,
      "language": "en",      // or "auto"
      "task": "transcribe",  // or "translate"
      "batch_size": 32
    }

Job output (consumed by services/runpod/fetch-job.ts):
    {
      "segments": [
        { "start": 0.5, "end": 4.2, "text": "...", "speaker": "SPEAKER_00" },
        ...
      ],
      "language": "en",
      "duration": 1834.5
    }

The worker loads models *once per cold-start* and reuses them across
subsequent jobs on the same warm worker. With RunPod FlashBoot this
amortizes the ~5s model-load cost across many calls.
"""

import os
import tempfile
import time
from typing import Any

import requests
import runpod
import torch
import whisperx
from pyannote.audio import Pipeline


DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
COMPUTE_TYPE = "float16" if DEVICE == "cuda" else "int8"


def _load_models() -> dict[str, Any]:
    """Load Whisper + alignment + diarization. Cached on the warm worker."""
    print(f"[whisperx] loading models on {DEVICE} ({COMPUTE_TYPE})...")
    t0 = time.time()
    asr = whisperx.load_model(
        "large-v3-turbo",
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
    )
    align_model, align_meta = whisperx.load_align_model(
        language_code="en",
        device=DEVICE,
    )
    diarize = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=os.environ.get("HF_TOKEN"),
    )
    if DEVICE == "cuda":
        diarize.to(torch.device("cuda"))
    print(f"[whisperx] models ready in {time.time() - t0:.1f}s")
    return {"asr": asr, "align_model": align_model, "align_meta": align_meta, "diarize": diarize}


# Module-level cache: persists between jobs on a warm worker.
MODELS: dict[str, Any] | None = None


def _download(url: str) -> str:
    """Stream an HTTPS audio URL to a temp file and return the path."""
    resp = requests.get(url, stream=True, timeout=120)
    resp.raise_for_status()
    suffix = os.path.splitext(url.split("?")[0])[1] or ".bin"
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="audio-")
    with os.fdopen(fd, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1 << 20):
            if chunk:
                f.write(chunk)
    return path


def handler(event: dict) -> dict:
    global MODELS
    if MODELS is None:
        MODELS = _load_models()

    inp = event.get("input") or {}
    audio_url = inp.get("audio_url")
    if not audio_url:
        return {"error": "input.audio_url is required"}

    diarize_flag = bool(inp.get("diarize", True))
    language = inp.get("language") or "en"
    task = inp.get("task") or "transcribe"
    batch_size = int(inp.get("batch_size") or 32)

    audio_path = _download(audio_url)
    try:
        audio = whisperx.load_audio(audio_path)
        duration = float(audio.shape[0]) / 16000.0

        # 1) ASR
        t0 = time.time()
        asr_result = MODELS["asr"].transcribe(
            audio,
            batch_size=batch_size,
            language=language if language != "auto" else None,
            task=task,
        )
        print(f"[whisperx] asr: {time.time() - t0:.1f}s for {duration:.1f}s audio")

        # 2) Alignment (word-level timestamps; needed by diarization assignment)
        t0 = time.time()
        aligned = whisperx.align(
            asr_result["segments"],
            MODELS["align_model"],
            MODELS["align_meta"],
            audio,
            DEVICE,
            return_char_alignments=False,
        )
        print(f"[whisperx] align: {time.time() - t0:.1f}s")

        # 3) Diarization (optional)
        if diarize_flag:
            t0 = time.time()
            diarization = MODELS["diarize"]({"waveform": torch.from_numpy(audio).unsqueeze(0), "sample_rate": 16000})
            diarize_df = whisperx.diarize.DiarizationPipeline.compose_segments(diarization)
            aligned = whisperx.assign_word_speakers(diarize_df, aligned)
            print(f"[whisperx] diarize: {time.time() - t0:.1f}s")

        segments_out: list[dict[str, Any]] = []
        for seg in aligned.get("segments", []):
            segments_out.append({
                "start": float(seg.get("start", 0.0)),
                "end": float(seg.get("end", 0.0)),
                "text": (seg.get("text") or "").strip(),
                "speaker": seg.get("speaker") or "SPEAKER_00",
            })

        return {
            "segments": segments_out,
            "language": asr_result.get("language", language),
            "duration": duration,
        }
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            pass


runpod.serverless.start({"handler": handler})
