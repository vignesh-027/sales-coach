// Provider-aware finalization for a transcription job.
//
// Both providers eventually produce a normalized `{ fullText, segments,
// durationSec, status, error }` blob (see services/transcription/types.ts).
// This module owns the "what to write to call_transcripts / transcripts"
// logic — branching only at the *fetch* step (AAI fetchTranscript vs
// RunPod fetchRunPodJob).
//
// Workers continue to import the old finalize helpers from
// services/assemblyai/finalize.ts which now delegate here.

import { tasks } from "@/worker/client";
import {
  getRecording,
  updateRecording,
  allRecordingsDone,
  type CallRecording,
} from "@/services/supabase/queries/call-recordings";
import { insertCallTranscript } from "@/services/supabase/queries/call-transcripts";
import { updateCallStatus } from "@/services/supabase/queries/calls";
import {
  getKnowledgeItem,
  updateKnowledgeStatus,
  type KnowledgeItem,
} from "@/services/supabase/queries/knowledge-items";
import { insertTranscript } from "@/services/supabase/queries/transcripts";
import { fetchTranscript } from "@/services/assemblyai/fetch-transcript";
import { recordAssemblyAiUsage } from "@/services/assemblyai/usage";
import { fetchRunPodJob } from "@/services/runpod/fetch-job";
import { recordModelUsage } from "@/services/supabase/queries/model-usage";
import { costForTranscriptionAudio } from "./models";
import type { NormalizedTranscript } from "./types";

export type FinalizeOutcome =
  | "completed"
  | "failed"
  | "already_terminal"
  | "still_processing";

export type TranscriptionProviderKind = "assemblyai" | "runpod";

async function fetchByProvider(
  provider: TranscriptionProviderKind,
  providerId: string,
): Promise<NormalizedTranscript> {
  if (provider === "assemblyai") {
    return fetchTranscript(providerId);
  }
  return fetchRunPodJob(providerId);
}

/**
 * Map a full transcription model id (e.g. "assemblyai/universal-2") to the
 * provider-specific model string used in usage rows. For AAI that's the
 * raw AAI model name ("universal-2" / "universal-3-pro"). For RunPod we
 * keep the full id since RunPod model_usage rows aren't aggregated against
 * an external pricing table.
 */
function modelStringForUsage(
  provider: TranscriptionProviderKind,
  storedModelId: string | null,
): string {
  if (provider === "assemblyai") {
    if (!storedModelId) return "universal-2";
    const slash = storedModelId.indexOf("/");
    return slash >= 0 ? storedModelId.slice(slash + 1) : storedModelId;
  }
  return storedModelId ?? "runpod/whisperx-turbo";
}

async function recordUsage(args: {
  provider: TranscriptionProviderKind;
  durationSec: number;
  scope: "transcribe_call" | "transcribe_knowledge";
  scopeId: string;
  storedModelId: string | null;
}): Promise<void> {
  if (!args.durationSec || args.durationSec <= 0) return;
  if (args.provider === "assemblyai") {
    void recordAssemblyAiUsage({
      model: modelStringForUsage("assemblyai", args.storedModelId),
      durationSec: args.durationSec,
      scope: args.scope,
      scopeId: args.scopeId,
    });
    return;
  }
  // RunPod — write one row to model_usage with the audio-hour estimate.
  // Precise compute-second accounting can be added later from the webhook
  // body's executionTime field.
  const modelId = args.storedModelId ?? "runpod/whisperx-turbo";
  void recordModelUsage({
    provider: "runpod",
    kind: "transcribe",
    model: modelId,
    duration_sec: args.durationSec,
    cost_usd: costForTranscriptionAudio(modelId, args.durationSec),
    scope: args.scope,
    scope_id: args.scopeId,
  }).catch((e: unknown) => {
    console.warn("recordModelUsage(runpod) failed", e);
  });
}

export async function finalizeCallTranscription(args: {
  recordingOrId: string | CallRecording;
  provider: TranscriptionProviderKind;
  providerId: string;
}): Promise<FinalizeOutcome> {
  const rec =
    typeof args.recordingOrId === "string"
      ? await getRecording(args.recordingOrId)
      : args.recordingOrId;
  if (!rec) return "already_terminal";
  if (rec.transcribe_status === "done" || rec.transcribe_status === "failed") {
    return "already_terminal";
  }

  const t = await fetchByProvider(args.provider, args.providerId);

  if (t.status === "error") {
    await updateRecording(rec.id, {
      transcribe_status: "failed",
      transcribe_error: t.error ?? "transcription error",
    });
    await updateCallStatus(rec.call_id, {
      process_status: "failed",
      process_error: `recording ${rec.recording_index}: ${t.error ?? "transcription error"}`,
    });
    return "failed";
  }

  if (t.status !== "completed") return "still_processing";

  await insertCallTranscript({
    call_recording_id: rec.id,
    full_text: t.fullText,
    segments: t.segments,
  });

  const durationSec = t.durationSec ? Math.round(t.durationSec) : null;
  await updateRecording(rec.id, {
    transcribe_status: "done",
    duration_sec: durationSec,
  });

  if (durationSec && durationSec > 0) {
    await recordUsage({
      provider: args.provider,
      durationSec,
      scope: "transcribe_call",
      scopeId: rec.call_id,
      storedModelId: rec.transcription_provider,
    });
  }

  if (await allRecordingsDone(rec.call_id)) {
    await updateCallStatus(rec.call_id, { process_status: "embedding" });
    await tasks.trigger<typeof import("@/worker/embed-call").embedCall>(
      "embed-call",
      { callId: rec.call_id },
    );
  }

  return "completed";
}

export async function finalizeKnowledgeTranscription(args: {
  itemOrId: string | KnowledgeItem;
  provider: TranscriptionProviderKind;
  providerId: string;
}): Promise<FinalizeOutcome> {
  const item =
    typeof args.itemOrId === "string"
      ? await getKnowledgeItem(args.itemOrId)
      : args.itemOrId;
  if (!item) return "already_terminal";
  if (
    item.process_status === "done" ||
    item.process_status === "failed" ||
    item.process_status === "embedding"
  ) {
    return "already_terminal";
  }

  const t = await fetchByProvider(args.provider, args.providerId);

  if (t.status === "error") {
    await updateKnowledgeStatus(item.id, {
      process_status: "failed",
      process_error: t.error ?? "transcription error",
    });
    return "failed";
  }

  if (t.status !== "completed") return "still_processing";

  await insertTranscript({
    knowledge_item_id: item.id,
    full_text: t.fullText,
    segments: t.segments,
  });

  const knowledgeDurationSec = t.durationSec ? Math.round(t.durationSec) : null;
  await updateKnowledgeStatus(item.id, {
    process_status: "embedding",
    duration_sec: knowledgeDurationSec,
  });

  if (knowledgeDurationSec && knowledgeDurationSec > 0) {
    await recordUsage({
      provider: args.provider,
      durationSec: knowledgeDurationSec,
      scope: "transcribe_knowledge",
      scopeId: item.id,
      storedModelId: item.transcription_provider,
    });
  }

  await tasks.trigger<
    typeof import("@/worker/embed-transcript").embedTranscript
  >("embed-transcript", { knowledgeItemId: item.id });

  return "completed";
}
