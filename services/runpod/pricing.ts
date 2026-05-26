// RunPod Serverless billing model.
//
// RunPod bills per compute-second on the GPU (not per audio-second), so
// the "true" cost per call is `executionTime_ms / 1000 * $/sec(GPU)`.
// However, the rest of the codebase reports cost-per-audio-hour (AAI's
// pricing model), so we expose two helpers:
//
//   - costForRunPodAudio()   — same shape as AAI's costForTranscription()
//                              uses a flat $/hr-audio estimate from the
//                              registry. Used for the usage tile.
//   - costForRunPodCompute() — precise: GPU $/sec × executionTime_sec.
//                              Use this when we wire up compute_sec
//                              accounting later.
//
// The flat estimate ($0.144/hr-audio for WhisperX turbo on RTX 4090) was
// derived from ~4× realtime measured on benchmarks. Real jobs will land
// in a 0.6×–1.5× band around it.

import { costForTranscriptionAudio } from "@/services/transcription/models";

export const RUNPOD_4090_PRICE_PER_SEC = 0.0004;

export function costForRunPodAudio(
  modelId: string,
  durationSec: number,
): number {
  return costForTranscriptionAudio(modelId, durationSec);
}

export function costForRunPodCompute(
  executionMs: number,
  pricePerSec = RUNPOD_4090_PRICE_PER_SEC,
): number {
  return (executionMs / 1000) * pricePerSec;
}
