// Shared transcription types used by both AAI and RunPod paths. The segment
// shape matches what we already store in `call_transcripts.segments` and
// `transcripts.segments` jsonb columns — re-exported here so providers don't
// import from the storage layer.

export type { TranscriptSegment } from "@/services/supabase/queries/transcripts";

/**
 * What the dispatcher returns after submitting an audio file to a provider.
 * `providerId` is whatever id the provider gave us to reference the job
 * later (AAI: transcript_id; RunPod: job id).
 */
export interface SubmitResult {
  provider: "assemblyai" | "runpod";
  providerId: string;
}

/**
 * Normalized "fetched" transcript shape produced by each provider's
 * fetch-* helper. Identical to what AAI's fetchTranscript() already returns
 * so finalize() can treat both providers uniformly.
 */
export type FetchStatus = "queued" | "processing" | "completed" | "error";

import type { TranscriptSegment } from "@/services/supabase/queries/transcripts";

export interface NormalizedTranscript {
  status: FetchStatus;
  fullText: string;
  durationSec: number | null;
  segments: TranscriptSegment[];
  error: string | null;
}
