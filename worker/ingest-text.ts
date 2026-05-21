import { task } from "@trigger.dev/sdk";
import { fetchR2Text, fetchR2Bytes } from "@/services/r2/fetch-object";
import { chunkText } from "@/lib/chunker";
import { embedBatch } from "@/services/voyage/embed";
import {
  getKnowledgeItem,
  updateKnowledgeStatus,
} from "@/services/supabase/queries/knowledge-items";
import { insertTranscript } from "@/services/supabase/queries/transcripts";
import { bulkInsertChunks } from "@/services/supabase/queries/knowledge-chunks";
import { formatError } from "@/services/format-error";
import { extFromFilename } from "@/services/upload/allowed-formats";
import mammoth from "mammoth";

async function extractText(r2Key: string): Promise<string> {
  const ext = extFromFilename(r2Key);
  if (ext === "docx") {
    const buf = await fetchR2Bytes(r2Key);
    // mammoth.extractRawText drops formatting and returns clean prose —
    // exactly what the chunker + embedder want. Tables/images are stripped.
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  // txt and md are already plain text.
  return fetchR2Text(r2Key);
}

export interface IngestTextPayload {
  knowledgeItemId: string;
}

export const ingestText = task({
  id: "ingest-text",
  retry: { maxAttempts: 3 },
  run: async (payload: IngestTextPayload) => {
    const item = await getKnowledgeItem(payload.knowledgeItemId);
    if (!item) throw new Error(`item ${payload.knowledgeItemId} not found`);
    if (item.source_format !== "text") {
      throw new Error(
        `ingest-text called on non-text item (source_format=${item.source_format})`,
      );
    }

    try {
      await updateKnowledgeStatus(item.id, { process_status: "embedding" });

      const fullText = await extractText(item.media_r2_key);
      await insertTranscript({
        knowledge_item_id: item.id,
        full_text: fullText,
        segments: [],
      });

      const chunks = chunkText(fullText);
      if (chunks.length === 0) {
        await updateKnowledgeStatus(item.id, {
          process_status: "failed",
          process_error: "empty text document",
        });
        return { chunks: 0 };
      }
      const vectors = await embedBatch(chunks.map((c) => c.text), {
        scope: "ingest_knowledge",
        scopeId: item.id,
      });
      await bulkInsertChunks(
        chunks.map((c, i) => ({
          knowledge_item_id: item.id,
          chunk_index: i,
          chunk_text: c.text,
          start_ts_ms: null,
          end_ts_ms: null,
          embedding: vectors[i],
        })),
      );
      await updateKnowledgeStatus(item.id, { process_status: "done" });
      return { chunks: chunks.length };
    } catch (err) {
      await updateKnowledgeStatus(item.id, {
        process_status: "failed",
        process_error: `text ingest failed: ${formatError(err)}`,
      });
      throw err;
    }
  },
});
