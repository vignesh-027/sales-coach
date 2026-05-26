import { task, tasks } from "./client";
import {
  finalizeCallTranscription,
  finalizeKnowledgeTranscription,
  type TranscriptionProviderKind,
} from "@/services/transcription/finalize";

// Webhook is the happy path. This task is the fallback: if the provider's
// webhook never reaches us (local dev with no tunnel, dropped POST, etc.),
// we still discover terminal state and write the outcome.

export type PollTarget =
  | { kind: "call_recording"; recordingId: string }
  | { kind: "knowledge_item"; itemId: string };

export interface PollTranscriptionPayload {
  provider: TranscriptionProviderKind;
  providerId: string;
  target: PollTarget;
  attempt?: number;
  // Back-compat for in-flight payloads from the AAI-only era. If present
  // and `providerId` is missing, treat the value as the AAI transcript id.
  transcriptId?: string;
}

const MAX_ATTEMPTS = 20; // 20 × 90s ≈ 30 min ceiling
const INITIAL_DELAY_S = 90;
const SUBSEQUENT_DELAY_S = 90;

export const pollTranscription = task({
  id: "poll-transcription",
  retry: { maxAttempts: 2 },
  maxDuration: 120,
  run: async (payload: PollTranscriptionPayload) => {
    const attempt = payload.attempt ?? 1;
    const provider: TranscriptionProviderKind =
      payload.provider ?? "assemblyai";
    const providerId =
      payload.providerId ?? (payload.transcriptId as string | undefined) ?? "";

    if (!providerId) {
      throw new Error("poll-transcription: missing providerId / transcriptId");
    }

    const outcome =
      payload.target.kind === "call_recording"
        ? await finalizeCallTranscription({
            recordingOrId: payload.target.recordingId,
            provider,
            providerId,
          })
        : await finalizeKnowledgeTranscription({
            itemOrId: payload.target.itemId,
            provider,
            providerId,
          });

    if (outcome !== "still_processing") {
      return { attempt, outcome };
    }

    if (attempt >= MAX_ATTEMPTS) {
      // Give up and mark failed via a one-shot error finalize.
      const giveUpMsg = `transcription still processing after ${attempt} polls (~${Math.round(
        (attempt * SUBSEQUENT_DELAY_S) / 60,
      )} min) — giving up`;
      if (payload.target.kind === "call_recording") {
        const { updateRecording, getRecording } = await import(
          "@/services/supabase/queries/call-recordings"
        );
        const { updateCallStatus } = await import(
          "@/services/supabase/queries/calls"
        );
        const rec = await getRecording(payload.target.recordingId);
        if (rec && rec.transcribe_status === "transcribing") {
          await updateRecording(rec.id, {
            transcribe_status: "failed",
            transcribe_error: giveUpMsg,
          });
          await updateCallStatus(rec.call_id, {
            process_status: "failed",
            process_error: `recording ${rec.recording_index}: ${giveUpMsg}`,
          });
        }
      } else {
        const { updateKnowledgeStatus, getKnowledgeItem } = await import(
          "@/services/supabase/queries/knowledge-items"
        );
        const item = await getKnowledgeItem(payload.target.itemId);
        if (item && item.process_status === "transcribing") {
          await updateKnowledgeStatus(item.id, {
            process_status: "failed",
            process_error: giveUpMsg,
          });
        }
      }
      return { attempt, outcome: "gave_up" as const };
    }

    await tasks.trigger<typeof pollTranscription>(
      "poll-transcription",
      { ...payload, provider, providerId, attempt: attempt + 1 },
      { delay: `${SUBSEQUENT_DELAY_S}s` },
    );
    return { attempt, outcome };
  },
});

export const POLL_INITIAL_DELAY = `${INITIAL_DELAY_S}s`;
