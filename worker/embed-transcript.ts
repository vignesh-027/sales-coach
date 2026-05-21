import { task } from "@trigger.dev/sdk";
import { chunkTranscript, chunkText } from "@/lib/chunker";
import { embedBatch } from "@/services/voyage/embed";
import { getTranscript } from "@/services/supabase/queries/transcripts";
import { bulkInsertChunks } from "@/services/supabase/queries/knowledge-chunks";
import {
  getKnowledgeItem,
  updateKnowledgeStatus,
} from "@/services/supabase/queries/knowledge-items";
import { formatError } from "@/services/format-error";

export interface EmbedTranscriptPayload {
  knowledgeItemId: string;
}

export const embedTranscript = task({
  id: "embed-transcript",
  retry: { maxAttempts: 3 },
  run: async (payload: EmbedTranscriptPayload) => {
    const item = await getKnowledgeItem(payload.knowledgeItemId);
    if (!item) throw new Error(`item ${payload.knowledgeItemId} not found`);
    const transcript = await getTranscript(payload.knowledgeItemId);
    if (!transcript) {
      throw new Error(
        `transcript for ${payload.knowledgeItemId} not found; webhook should have written it`,
      );
    }

    try {
      // Text docs store their content in full_text with empty segments
      // (no timestamps). Media transcripts have timestamped segments.
      const isText = item.source_format === "text";
      const chunks = isText
        ? chunkText(transcript.full_text)
        : chunkTranscript(transcript.segments);
      if (chunks.length === 0) {
        await updateKnowledgeStatus(payload.knowledgeItemId, {
          process_status: "failed",
          process_error: "no chunks produced from empty transcript",
        });
        return { chunks: 0 };
      }

      const vectors = await embedBatch(chunks.map((c) => c.text), {
        scope: "ingest_knowledge",
        scopeId: payload.knowledgeItemId,
      });

      await bulkInsertChunks(
        chunks.map((c, i) => ({
          knowledge_item_id: payload.knowledgeItemId,
          chunk_index: i,
          chunk_text: c.text,
          start_ts_ms: isText ? null : c.start_ts_ms,
          end_ts_ms: isText ? null : c.end_ts_ms,
          embedding: vectors[i],
        })),
      );

      await updateKnowledgeStatus(payload.knowledgeItemId, {
        process_status: "done",
      });

      return { chunks: chunks.length };
    } catch (err) {
      await updateKnowledgeStatus(payload.knowledgeItemId, {
        process_status: "failed",
        process_error: `embedding failed: ${formatError(err)}`,
      });
      throw err;
    }
  },
});
