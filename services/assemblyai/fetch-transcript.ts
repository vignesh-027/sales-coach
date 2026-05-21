import { aaiFetch } from "./client";
import type { TranscriptSegment } from "../supabase/queries/transcripts";

interface AaiUtterance {
  start: number;
  end: number;
  text: string;
  speaker: string;
}

export type AaiStatus = "queued" | "processing" | "completed" | "error";

interface AaiTranscriptResponse {
  id: string;
  status: AaiStatus;
  text: string | null;
  audio_duration: number | null;
  error: string | null;
  utterances: AaiUtterance[] | null;
}

export interface TranscriptFetch {
  status: AaiStatus;
  fullText: string;
  durationSec: number | null;
  segments: TranscriptSegment[];
  error: string | null;
}

export async function fetchTranscript(
  transcriptId: string,
): Promise<TranscriptFetch> {
  const res = await aaiFetch(`/transcript/${transcriptId}`);
  const data = (await res.json()) as AaiTranscriptResponse;

  if (data.status === "error") {
    return {
      status: "error",
      fullText: "",
      durationSec: data.audio_duration ?? null,
      segments: [],
      error: data.error ?? "AssemblyAI returned status=error",
    };
  }
  if (data.status !== "completed") {
    return {
      status: data.status,
      fullText: "",
      durationSec: data.audio_duration ?? null,
      segments: [],
      error: null,
    };
  }

  const utterances = data.utterances ?? [];
  const segments: TranscriptSegment[] = utterances.map((u) => ({
    speaker: u.speaker,
    start_ms: u.start,
    end_ms: u.end,
    text: u.text,
  }));

  return {
    status: "completed",
    fullText: data.text ?? segments.map((s) => s.text).join(" "),
    durationSec: data.audio_duration ?? null,
    segments,
    error: null,
  };
}

// Backwards-compatible alias. New code should use fetchTranscript.
export type CompletedTranscript = TranscriptFetch;
export const getCompletedTranscript = fetchTranscript;
