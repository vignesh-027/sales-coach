// Allow-list of transcription provider/model combinations exposed in the
// Settings → Configuration picker.
//
// The admin dropdown shows these options; the settings API validates the
// incoming model id against this list. Adding a provider is a three-step
// edit: add an entry here → add a submit/fetch helper under
// services/<provider>/ → branch on it in services/transcription/dispatch.ts.
//
// IDs are <provider>/<model> so we can fan them out into provider-specific
// submit calls without an extra mapping table.

export type TranscriptionProvider = "assemblyai" | "runpod";

export interface TranscriptionOption {
  id: string;
  label: string;
  description: string;
  provider: TranscriptionProvider;
  /**
   * Provider-specific model identifier. For AAI this is what we put in
   * `speech_models: [...]`. For RunPod this is informational — the actual
   * model is baked into the Docker image.
   */
  model: string;
  /** Approximate $/hour-of-audio for the usage tile. Updated when prices change. */
  cost_per_hr_audio: number;
  tier: "paid";
}

export const TRANSCRIPTION_OPTIONS: readonly TranscriptionOption[] = [
  {
    id: "assemblyai/universal-2",
    label: "AssemblyAI · Universal-2",
    description:
      "Default. Mature diarization, English-strong, fast wallclock (~3–6 min for a 1 hr call).",
    provider: "assemblyai",
    model: "universal-2",
    cost_per_hr_audio: 0.27,
    tier: "paid",
  },
  {
    id: "assemblyai/universal-3-pro",
    label: "AssemblyAI · Universal-3 Pro",
    description:
      "Newer AAI tier — lower WER on conversational audio at higher cost.",
    provider: "assemblyai",
    model: "universal-3-pro",
    cost_per_hr_audio: 0.42,
    tier: "paid",
  },
  {
    id: "runpod/whisperx-turbo",
    label: "WhisperX large-v3-turbo (RunPod 4090)",
    description:
      "Self-hosted WhisperX on RunPod Serverless RTX 4090. Whisper-large-v3-turbo + pyannote diarization. ~4–6 min for a 1 hr call.",
    provider: "runpod",
    model: "large-v3-turbo",
    cost_per_hr_audio: 0.144,
    tier: "paid",
  },
] as const;

export const DEFAULT_TRANSCRIPTION_MODEL = "assemblyai/universal-2";

export function isAllowedTranscriptionModel(id: string): boolean {
  return TRANSCRIPTION_OPTIONS.some((o) => o.id === id);
}

export function findTranscriptionOption(
  id: string,
): TranscriptionOption | undefined {
  return TRANSCRIPTION_OPTIONS.find((o) => o.id === id);
}

export function costForTranscriptionAudio(
  id: string,
  durationSec: number,
): number {
  const opt = findTranscriptionOption(id);
  if (!opt) return 0;
  return (opt.cost_per_hr_audio * durationSec) / 3600;
}
