import { task, tasks } from "./client";
import { signedGetUrl } from "@/services/r2/signed-url";
import { submitTranscription } from "@/services/assemblyai/transcribe";
import {
  getRecording,
  updateRecording,
} from "@/services/supabase/queries/call-recordings";
import { updateCallStatus } from "@/services/supabase/queries/calls";
import {
  POLL_INITIAL_DELAY,
  type pollTranscription,
} from "./poll-transcription";
import { formatError } from "@/services/format-error";

export interface IngestCallRecordingPayload {
  callId: string;
  recordingId: string;
  webhookBaseUrl: string;
}

export const ingestCallRecording = task({
  id: "ingest-call-recording",
  retry: { maxAttempts: 3 },
  run: async (payload: IngestCallRecordingPayload) => {
    const rec = await getRecording(payload.recordingId);
    if (!rec) throw new Error(`call_recording ${payload.recordingId} not found`);

    await updateRecording(rec.id, {
      transcribe_status: "transcribing",
      transcribe_error: null,
    });
    await updateCallStatus(payload.callId, { process_status: "transcribing" });

    const audioUrl = await signedGetUrl(rec.media_r2_key, 60 * 60 * 6);
    const webhookUrl = `${payload.webhookBaseUrl}/api/calls/transcription-callback`;

    try {
      const { transcriptId } = await submitTranscription({
        audioUrl,
        webhookUrl,
        webhookSecret: rec.webhook_secret,
      });
      await updateRecording(rec.id, {
        assemblyai_transcript_id: transcriptId,
      });

      // Webhook is the happy path; this poller is the fallback in case the
      // webhook never arrives (local dev with no tunnel, dropped delivery,
      // AAI hang). Idempotent against the webhook via finalize() checks.
      await tasks.trigger<typeof pollTranscription>(
        "poll-transcription",
        {
          transcriptId,
          target: { kind: "call_recording", recordingId: rec.id },
        },
        { delay: POLL_INITIAL_DELAY },
      );

      return { transcriptId };
    } catch (err) {
      const msg = formatError(err);
      await updateRecording(rec.id, {
        transcribe_status: "failed",
        transcribe_error: `transcription submit failed: ${msg}`,
      });
      await updateCallStatus(payload.callId, {
        process_status: "failed",
        process_error: `recording ${rec.recording_index}: ${msg}`,
      });
      throw err;
    }
  },
});
