import { task, tasks } from "./client";
import { signedGetUrl } from "@/services/r2/signed-url";
import { submitTranscription } from "@/services/transcription/dispatch";
import {
  getKnowledgeItem,
  updateKnowledgeStatus,
} from "@/services/supabase/queries/knowledge-items";
import {
  POLL_INITIAL_DELAY,
  type pollTranscription,
} from "./poll-transcription";
import { formatError } from "@/services/format-error";

export interface IngestKnowledgePayload {
  knowledgeItemId: string;
  webhookBaseUrl: string; // e.g. https://app.example.com  (no trailing slash)
}

export const ingestKnowledge = task({
  id: "ingest-knowledge",
  retry: { maxAttempts: 3 },
  // Last-resort terminal-state writer. Runs once after all retries are
  // exhausted, regardless of where the failure happened (import-time crash,
  // throw before the inner try/catch, OOM, etc). Guarantees the DB reflects
  // reality so the UI never shows a phantom "transcribing" status.
  onFailure: async ({ payload, error }) => {
    try {
      await updateKnowledgeStatus(payload.knowledgeItemId, {
        process_status: "failed",
        process_error: `ingest failed: ${formatError(error)}`,
      });
    } catch (writeErr) {
      console.error("[ingest-knowledge.onFailure] DB write failed", writeErr);
    }
  },
  run: async (payload: IngestKnowledgePayload) => {
    const item = await getKnowledgeItem(payload.knowledgeItemId);
    if (!item) throw new Error(`knowledge_item ${payload.knowledgeItemId} not found`);

    await updateKnowledgeStatus(item.id, { process_status: "transcribing" });

    const audioUrl = await signedGetUrl(item.media_r2_key, 60 * 60 * 6);
    const webhookUrl = `${payload.webhookBaseUrl}/api/transcription-callback`;

    try {
      const { provider, providerId, modelId } = await submitTranscription({
        audioUrl,
        webhookUrl,
        webhookSecret: item.webhook_secret,
      });
      await updateKnowledgeStatus(item.id, {
        transcription_provider: modelId,
        ...(provider === "assemblyai"
          ? { assemblyai_transcript_id: providerId }
          : { runpod_job_id: providerId }),
      });

      await tasks.trigger<typeof pollTranscription>(
        "poll-transcription",
        {
          provider,
          providerId,
          target: { kind: "knowledge_item", itemId: item.id },
        },
        { delay: POLL_INITIAL_DELAY },
      );

      return { provider, providerId, modelId };
    } catch (err) {
      await updateKnowledgeStatus(item.id, {
        process_status: "failed",
        process_error: `transcription submit failed: ${formatError(err)}`,
      });
      throw err;
    }
  },
});
