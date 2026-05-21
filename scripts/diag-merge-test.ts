// End-to-end re-run that calls Claude directly with the FIXED merge logic.
// This tells us whether the fix produces a complete report BEFORE we wait
// for the Trigger.dev deploy + a real re-run.
import { runAnalysis } from "../services/anthropic/analyze-call";
import { getCall } from "../services/supabase/queries/calls";
import { listRecordings } from "../services/supabase/queries/call-recordings";
import { listCallTranscriptsOrdered } from "../services/supabase/queries/call-transcripts";
import {
  listKnowledgeItems,
  getKnowledgeItem,
} from "../services/supabase/queries/knowledge-items";
import { getTranscript } from "../services/supabase/queries/transcripts";
import { hybridSearchKnowledge } from "../services/supabase/queries/knowledge-chunks";
import { embedBatch } from "../services/voyage/embed";
import { rerank } from "../services/voyage/rerank";
import { buildSearchQuery } from "../services/voyage/build-search-query";

const callId = process.argv[2];

(async () => {
  const call = await getCall(callId);
  if (!call) throw new Error("call not found");
  const [recordings, transcripts] = await Promise.all([
    listRecordings(callId),
    listCallTranscriptsOrdered(callId),
  ]);
  const recordingsForPrompt = transcripts.map((t) => {
    const r = recordings.find((x) => x.id === t.call_recording_id);
    return {
      index: t.recording_index,
      duration_sec: r?.duration_sec ?? null,
      full_text: t.full_text,
      segments: t.segments,
    };
  });
  const items = await listKnowledgeItems();
  const founderItems = items.filter(
    (i) => i.process_status === "done" && i.kind === "founder_video",
  );
  const founderVideos = (
    await Promise.all(
      founderItems.map(async (i) => {
        const t = await getTranscript(i.id);
        return t ? { title: i.title, full_text: t.full_text } : null;
      }),
    )
  ).flatMap((s) => (s ? [s] : []));

  const { embeddingText, ftsText } = buildSearchQuery(
    recordingsForPrompt.map((r) => r.full_text).join("\n\n"),
  );
  const [queryVec] = await embedBatch([embeddingText], {
    inputType: "query",
    scope: "diag",
    scopeId: callId,
  });
  const hits = await hybridSearchKnowledge(queryVec, ftsText, 50, [
    "reference_call",
    "text_document",
  ]);
  const reranked = await rerank(
    ftsText,
    hits.map((h) => h.chunk_text),
    { model: "rerank-2.5-lite", topK: 10, scope: "diag", scopeId: callId },
  );
  const retrievedReferenceChunks = await Promise.all(
    reranked.hits.map(async (rh) => {
      const h = hits[rh.index];
      const item = await getKnowledgeItem(h.knowledge_item_id);
      return {
        title: item?.title ?? "(unknown)",
        source_type:
          (item?.kind === "text_document"
            ? "text_document"
            : "reference_call") as "reference_call" | "text_document",
        start_ts_ms: h.start_ts_ms,
        end_ts_ms: h.end_ts_ms,
        chunk_text: h.chunk_text,
      };
    }),
  );

  const result = await runAnalysis({
    call: {
      call_type: call.call_type,
      client_name: call.client_name,
      salesperson_name: call.salesperson_name,
    },
    recordings: recordingsForPrompt,
    playbook: {
      founder_videos: founderVideos,
      retrieved_reference_chunks: retrievedReferenceChunks,
    },
  });

  console.log("=== MERGED REPORT (post-fix) ===");
  console.log("model:", result.model);
  console.log("tokens:", result.input_tokens, "→", result.output_tokens);
  const r = result.report as unknown as {
    summary?: { tldr?: string; outcome?: string; deal_health?: string };
    key_moments?: unknown[];
    rewrites?: unknown[];
    patterns?: unknown[];
  };
  console.log("FIELDS PRESENT:", {
    summary: !!r.summary,
    key_moments: Array.isArray(r.key_moments) ? r.key_moments.length : "missing",
    rewrites: Array.isArray(r.rewrites) ? r.rewrites.length : "missing",
    patterns: Array.isArray(r.patterns) ? r.patterns.length : "missing",
  });
  console.log("summary.outcome:", r.summary?.outcome);
  console.log("summary.deal_health:", r.summary?.deal_health);
})();
