// AAI-specific facade over the provider-agnostic finalizer.
//
// Existing call sites (poll-transcription worker, the AAI webhook routes)
// pass a transcriptId and expect AAI behaviour. We keep those signatures
// working by delegating to services/transcription/finalize.ts with
// provider="assemblyai".
//
// New code paths (the RunPod webhook route) should call the new
// finalizeCallTranscription / finalizeKnowledgeTranscription helpers
// directly with the right provider.

import type { CallRecording } from "@/services/supabase/queries/call-recordings";
import type { KnowledgeItem } from "@/services/supabase/queries/knowledge-items";
import {
  finalizeCallTranscription,
  finalizeKnowledgeTranscription,
  type FinalizeOutcome,
} from "@/services/transcription/finalize";

export type { FinalizeOutcome } from "@/services/transcription/finalize";

export async function finalizeCallRecording(
  recordingOrId: string | CallRecording,
  transcriptId: string,
): Promise<FinalizeOutcome> {
  return finalizeCallTranscription({
    recordingOrId,
    provider: "assemblyai",
    providerId: transcriptId,
  });
}

export async function finalizeKnowledgeItem(
  itemOrId: string | KnowledgeItem,
  transcriptId: string,
): Promise<FinalizeOutcome> {
  return finalizeKnowledgeTranscription({
    itemOrId,
    provider: "assemblyai",
    providerId: transcriptId,
  });
}
