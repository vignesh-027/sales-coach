import { tasks } from "@/worker/client";
import { fetchTranscript } from "./fetch-transcript";
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
import { recordAssemblyAiUsage } from "./usage";

export type FinalizeOutcome =
  | "completed"
  | "failed"
  | "already_terminal"
  | "still_processing";

export async function finalizeCallRecording(
  recordingOrId: string | CallRecording,
  transcriptId: string,
): Promise<FinalizeOutcome> {
  const rec =
    typeof recordingOrId === "string"
      ? await getRecording(recordingOrId)
      : recordingOrId;
  if (!rec) return "already_terminal";
  if (rec.transcribe_status === "done" || rec.transcribe_status === "failed") {
    return "already_terminal";
  }

  const t = await fetchTranscript(transcriptId);

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
    void recordAssemblyAiUsage({
      durationSec,
      scope: "transcribe_call",
      scopeId: rec.call_id,
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

export async function finalizeKnowledgeItem(
  itemOrId: string | KnowledgeItem,
  transcriptId: string,
): Promise<FinalizeOutcome> {
  const item =
    typeof itemOrId === "string"
      ? await getKnowledgeItem(itemOrId)
      : itemOrId;
  if (!item) return "already_terminal";
  if (
    item.process_status === "done" ||
    item.process_status === "failed" ||
    item.process_status === "embedding"
  ) {
    return "already_terminal";
  }

  const t = await fetchTranscript(transcriptId);

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
    void recordAssemblyAiUsage({
      durationSec: knowledgeDurationSec,
      scope: "transcribe_knowledge",
      scopeId: item.id,
    });
  }

  await tasks.trigger<
    typeof import("@/worker/embed-transcript").embedTranscript
  >("embed-transcript", { knowledgeItemId: item.id });

  return "completed";
}
