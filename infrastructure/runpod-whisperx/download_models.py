"""Pre-fetch Whisper + pyannote weights into the image at build time.

Why bake into the image rather than download on first job?
  * Cold-start budget. Downloading large-v3-turbo (~1.5 GB) + pyannote
    diarization 3.1 (~150 MB) at runtime adds ~30s to every cold start.
    Baking them in means cold-start is just CUDA init + model load
    (~5–10s with RunPod FlashBoot).
  * Reproducibility. Model versions are pinned to the image tag.

This script runs ONCE at build time (`RUN python download_models.py`).
Requires HuggingFace_Token env var (set from the HuggingFace_Token build-arg) to
download the diarization model — pyannote gates its weights behind a
HuggingFace "I accept" click.
"""

import os
import sys

import whisperx
from pyannote.audio import Pipeline


def main() -> None:
    hf_token = os.environ.get("HuggingFace_Token")
    if not hf_token:
        print("ERROR: HuggingFace_Token not set. Pass --build-arg HuggingFace_Token=hf_xxx", file=sys.stderr)
        sys.exit(1)

    # Whisper large-v3-turbo: faster-whisper's CTranslate2-compiled variant.
    # WhisperX wraps it; loading triggers the model download into the HF cache.
    print("Downloading Whisper large-v3-turbo...")
    whisperx.load_model(
        "large-v3-turbo",
        device="cpu",         # GPU isn't available at build time on most CI
        compute_type="int8",  # only for the download — runtime overrides
    )

    # English alignment model (wav2vec2). WhisperX needs this for word
    # timestamps before diarization.
    print("Downloading wav2vec2 alignment (en)...")
    whisperx.load_align_model(language_code="en", device="cpu")

    # pyannote.audio 3.1 speaker diarization. Gated — requires HF token.
    print("Downloading pyannote/speaker-diarization-3.1...")
    # pyannote.audio 4.x renamed `use_auth_token` → `token`.
    Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token,
    )

    print("All models cached.")


if __name__ == "__main__":
    main()
