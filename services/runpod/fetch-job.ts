// Fetch a finished RunPod job and normalize its WhisperX output to the
// shared TranscriptSegment shape.
//
// We poll /status/{id} both as a fallback (when the webhook never arrives)
// and to read the payload from the webhook handler (RunPod's webhook body
// includes the output, but we keep one canonical reader here so we don't
// duplicate JSON parsing logic).
//
// WhisperX output looks like:
//   {
//     "output": {
//       "segments": [
//         { "start": 0.5, "end": 4.2, "text": "...", "speaker": "SPEAKER_00" },
//         ...
//       ],
//       "language": "en",
//       "duration": 1834.5     // seconds (we compute if missing)
//     },
//     "status": "COMPLETED",
//     "executionTime": 612000   // ms — useful for cost reconciliation
//   }
//
// RunPod statuses: IN_QUEUE | IN_PROGRESS | COMPLETED | FAILED | CANCELLED | TIMED_OUT

import { runpodFetch } from "./client";
import type {
  FetchStatus,
  NormalizedTranscript,
} from "@/services/transcription/types";
import type { TranscriptSegment } from "@/services/supabase/queries/transcripts";

interface WhisperXSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

interface RunPodJobResponse {
  id: string;
  status:
    | "IN_QUEUE"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED"
    | "TIMED_OUT";
  output?: {
    segments?: WhisperXSegment[];
    language?: string;
    duration?: number;
  } | null;
  error?: string | null;
  executionTime?: number;
  delayTime?: number;
}

const RUNPOD_TO_NORMALIZED: Record<RunPodJobResponse["status"], FetchStatus> = {
  IN_QUEUE: "queued",
  IN_PROGRESS: "processing",
  COMPLETED: "completed",
  FAILED: "error",
  CANCELLED: "error",
  TIMED_OUT: "error",
};

/**
 * Map WhisperX's `SPEAKER_00`, `SPEAKER_01`, ... onto `A`, `B`, ... so the
 * UI shows the same speaker chips it does for AAI ("A" / "B" / "C").
 * Unknown speakers fall back to "?".
 */
function normalizeSpeaker(raw: string | undefined): string {
  if (!raw) return "?";
  const m = /^SPEAKER_(\d+)$/i.exec(raw);
  if (!m) return raw;
  const n = parseInt(m[1]!, 10);
  if (Number.isNaN(n)) return raw;
  // 0 → "A", 1 → "B", ...
  return String.fromCharCode(65 + (n % 26));
}

function normalizeSegments(
  raw: WhisperXSegment[] | undefined,
): TranscriptSegment[] {
  if (!raw || raw.length === 0) return [];
  return raw.map((s) => ({
    speaker: normalizeSpeaker(s.speaker),
    start_ms: Math.round(s.start * 1000),
    end_ms: Math.round(s.end * 1000),
    text: (s.text ?? "").trim(),
  }));
}

export async function fetchRunPodJob(
  jobId: string,
): Promise<NormalizedTranscript> {
  const res = await runpodFetch(`/status/${jobId}`);
  const data = (await res.json()) as RunPodJobResponse;
  const status = RUNPOD_TO_NORMALIZED[data.status];

  if (status === "error") {
    return {
      status: "error",
      fullText: "",
      durationSec: data.output?.duration ?? null,
      segments: [],
      error: data.error ?? `RunPod job ${data.status}`,
    };
  }
  if (status !== "completed") {
    return {
      status,
      fullText: "",
      durationSec: null,
      segments: [],
      error: null,
    };
  }

  const segments = normalizeSegments(data.output?.segments);
  const fullText = segments.map((s) => s.text).join(" ").trim();
  const lastEndMs = segments.length
    ? segments[segments.length - 1]!.end_ms
    : null;
  const durationSec =
    data.output?.duration ?? (lastEndMs != null ? lastEndMs / 1000 : null);

  return {
    status: "completed",
    fullText,
    durationSec,
    segments,
    error: null,
  };
}

/**
 * Parse a webhook body (the JSON RunPod POSTs to our callback) into the
 * same NormalizedTranscript shape. Saves a round-trip — RunPod inlines the
 * full output in the webhook for COMPLETED jobs.
 */
export function parseRunPodWebhookBody(body: unknown): {
  jobId: string;
  transcript: NormalizedTranscript;
} {
  const data = body as RunPodJobResponse;
  const jobId = data.id;
  if (!jobId) throw new Error("RunPod webhook missing job id");
  const status = RUNPOD_TO_NORMALIZED[data.status];

  if (status === "error") {
    return {
      jobId,
      transcript: {
        status: "error",
        fullText: "",
        durationSec: data.output?.duration ?? null,
        segments: [],
        error: data.error ?? `RunPod job ${data.status}`,
      },
    };
  }
  if (status !== "completed") {
    return {
      jobId,
      transcript: {
        status,
        fullText: "",
        durationSec: null,
        segments: [],
        error: null,
      },
    };
  }

  const segments = normalizeSegments(data.output?.segments);
  const fullText = segments.map((s) => s.text).join(" ").trim();
  const lastEndMs = segments.length
    ? segments[segments.length - 1]!.end_ms
    : null;
  const durationSec =
    data.output?.duration ?? (lastEndMs != null ? lastEndMs / 1000 : null);

  return {
    jobId,
    transcript: {
      status: "completed",
      fullText,
      durationSec,
      segments,
      error: null,
    },
  };
}
