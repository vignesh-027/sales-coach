import { task, tasks } from "@trigger.dev/sdk";
import { chunkTranscript } from "@/lib/chunker";
import { embedBatch } from "@/services/voyage/embed";
import { updateCallStatus } from "@/services/supabase/queries/calls";
import { listCallTranscriptsOrdered } from "@/services/supabase/queries/call-transcripts";
import { bulkInsertCallChunks } from "@/services/supabase/queries/call-chunks";
import { formatError } from "@/services/format-error";

export interface EmbedCallPayload {
  callId: string;
}

export const embedCall = task({
  id: "embed-call",
  retry: { maxAttempts: 3 },
  run: async (payload: EmbedCallPayload) => {
    await updateCallStatus(payload.callId, {
      process_status: "embedding",
      process_error: null,
    });

    const transcripts = await listCallTranscriptsOrdered(payload.callId);
    if (transcripts.length === 0) {
      await updateCallStatus(payload.callId, {
        process_status: "failed",
        process_error: "no transcripts found for call",
      });
      return { chunks: 0 };
    }

    try {
      // Flatten all recordings' segments into one ordered chunk list, tagging
      // each chunk back to its recording_id for traceability.
      const allChunks: Array<{
        recording_id: string;
        text: string;
        start_ts_ms: number;
        end_ts_ms: number;
      }> = [];
      for (const t of transcripts) {
        const cs = chunkTranscript(t.segments);
        for (const c of cs) {
          allChunks.push({
            recording_id: t.call_recording_id,
            text: c.text,
            start_ts_ms: c.start_ts_ms,
            end_ts_ms: c.end_ts_ms,
          });
        }
      }

      if (allChunks.length === 0) {
        await updateCallStatus(payload.callId, {
          process_status: "failed",
          process_error: "no chunks produced from empty transcripts",
        });
        return { chunks: 0 };
      }

      const vectors = await embedBatch(allChunks.map((c) => c.text), {
        scope: "ingest_call",
        scopeId: payload.callId,
      });

      await bulkInsertCallChunks(
        allChunks.map((c, i) => ({
          call_id: payload.callId,
          call_recording_id: c.recording_id,
          chunk_index: i,
          chunk_text: c.text,
          start_ts_ms: c.start_ts_ms,
          end_ts_ms: c.end_ts_ms,
          embedding: vectors[i],
        })),
      );

      await updateCallStatus(payload.callId, { process_status: "analyzing" });

      await tasks.trigger<typeof import("./analyze-call").analyzeCall>(
        "analyze-call",
        { callId: payload.callId },
      );

      return { chunks: allChunks.length };
    } catch (err) {
      await updateCallStatus(payload.callId, {
        process_status: "failed",
        process_error: `embedding failed: ${formatError(err)}`,
      });
      throw err;
    }
  },
});
