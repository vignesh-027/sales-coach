import { task } from "@trigger.dev/sdk";
import { getCall, updateCallStatus } from "@/services/supabase/queries/calls";
import { listRecordings } from "@/services/supabase/queries/call-recordings";
import { listCallTranscriptsOrdered } from "@/services/supabase/queries/call-transcripts";
import {
  listKnowledgeItems,
  getKnowledgeItem,
} from "@/services/supabase/queries/knowledge-items";
import { getTranscript } from "@/services/supabase/queries/transcripts";
import { hybridSearchKnowledge } from "@/services/supabase/queries/knowledge-chunks";
import { upsertCallReport } from "@/services/supabase/queries/call-reports";
import { recordModelUsage } from "@/services/supabase/queries/model-usage";
import { costForLlm } from "@/services/anthropic/models";
import { embedBatch } from "@/services/voyage/embed";
import { rerank } from "@/services/voyage/rerank";
import { getRerankModel } from "@/services/supabase/queries/app-settings";
import { buildSearchQuery } from "@/services/voyage/build-search-query";
import {
  recordCallAnalysisInput,
  type RetrievedChunkLog,
} from "@/services/supabase/queries/call-analysis-inputs";
import {
  runAnalysis,
  type RetrievedChunk,
} from "@/services/anthropic/analyze-call";
import { formatError } from "@/services/format-error";

export interface AnalyzeCallPayload {
  callId: string;
}

// Hybrid + rerank funnel: pull a wider candidate pool from the vector index,
// then let the cross-encoder reranker narrow to the top-K the LLM actually sees.
const CANDIDATE_POOL_SIZE = 50;
const RERANK_TOP_K = 10;

export const analyzeCall = task({
  id: "analyze-call",
  retry: { maxAttempts: 2 },
  maxDuration: 600,
  // Terminal-state writer after retries exhausted. Catches anything the
  // inner try/catch misses (import-time crash, throw before try, etc).
  onFailure: async ({ payload, error }) => {
    try {
      await updateCallStatus(payload.callId, {
        process_status: "failed",
        process_error: `analysis failed: ${formatError(error)}`,
      });
    } catch (writeErr) {
      console.error("[analyze-call.onFailure] DB write failed", writeErr);
    }
  },
  run: async (payload: AnalyzeCallPayload) => {
    const call = await getCall(payload.callId);
    if (!call) throw new Error(`call ${payload.callId} not found`);

    await updateCallStatus(payload.callId, {
      process_status: "analyzing",
      process_error: null,
    });

    try {
      const [recordings, transcripts] = await Promise.all([
        listRecordings(payload.callId),
        listCallTranscriptsOrdered(payload.callId),
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

      // Canon: every done founder_video in full.
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

      // Long-tail: hybrid (vector + FTS, RRF-fused) reference_call +
      // text_document chunks against this call.
      const { embeddingText, ftsText } = buildSearchQuery(
        recordingsForPrompt.map((r) => r.full_text).join("\n\n"),
      );

      let retrievedReferenceChunks: RetrievedChunk[] = [];
      let rerankStats = {
        vector_hits: 0,
        fts_hits: 0,
        fused_candidates: 0,
        rerank_kept: 0,
        rerank_dropped_below_threshold: 0,
        rerank_fallback_used: false,
        rerank_model: "",
      };
      const retrievedLogs: RetrievedChunkLog[] = [];
      if (embeddingText.length > 0) {
        const [queryVec] = await embedBatch([embeddingText], {
          inputType: "query",
          scope: "analyze_call",
          scopeId: payload.callId,
        });
        const hits = await hybridSearchKnowledge(
          queryVec,
          ftsText,
          CANDIDATE_POOL_SIZE,
          ["reference_call", "text_document"],
        );
        rerankStats.vector_hits = hits.filter((h) => h.vector_rank > 0).length;
        rerankStats.fts_hits = hits.filter((h) => h.fts_rank > 0).length;
        rerankStats.fused_candidates = hits.length;

        if (hits.length > 0) {
          const rerankModel = await getRerankModel();
          const reranked = await rerank(
            ftsText,
            hits.map((h) => h.chunk_text),
            {
              model: rerankModel,
              topK: RERANK_TOP_K,
              scope: "analyze_call",
              scopeId: payload.callId,
            },
          );
          rerankStats = {
            ...rerankStats,
            rerank_kept: reranked.hits.length,
            rerank_dropped_below_threshold: reranked.dropped_below_threshold,
            rerank_fallback_used: reranked.fallback_used,
            rerank_model: reranked.model,
          };

          const titleCache = new Map<string, string>();
          const sourceKindCache = new Map<
            string,
            "reference_call" | "text_document"
          >();
          async function resolveItem(id: string) {
            let title = titleCache.get(id);
            let kind = sourceKindCache.get(id);
            if (!title || !kind) {
              const item = await getKnowledgeItem(id);
              title = item?.title ?? "(unknown)";
              kind =
                item?.kind === "text_document"
                  ? "text_document"
                  : "reference_call";
              titleCache.set(id, title);
              sourceKindCache.set(id, kind);
            }
            return { title, kind };
          }

          const keptIndexSet = new Set(reranked.hits.map((rh) => rh.index));

          // Build the prompt's retrieved chunks list (top-K, in rerank order).
          retrievedReferenceChunks = await Promise.all(
            reranked.hits.map(async (rh) => {
              const h = hits[rh.index];
              const { title, kind } = await resolveItem(h.knowledge_item_id);
              return {
                title,
                source_type: kind,
                start_ts_ms: h.start_ts_ms,
                end_ts_ms: h.end_ts_ms,
                chunk_text: h.chunk_text,
              };
            }),
          );

          // Build the observability snapshot — every candidate, with its
          // ranks/scores and whether it survived rerank.
          const scoreByIndex = new Map<number, number>(
            reranked.hits.map((rh) => [rh.index, rh.score]),
          );
          for (let i = 0; i < hits.length; i++) {
            const h = hits[i];
            const { title } = await resolveItem(h.knowledge_item_id);
            retrievedLogs.push({
              source: "knowledge",
              parent_id: h.knowledge_item_id,
              parent_title: title,
              snippet: h.chunk_text.slice(0, 300),
              vector_rank: h.vector_rank > 0 ? h.vector_rank : null,
              fts_rank: h.fts_rank > 0 ? h.fts_rank : null,
              fused_score: h.fused_score,
              rerank_score: scoreByIndex.get(i) ?? null,
              kept: keptIndexSet.has(i),
            });
          }
        }
      }

      // eslint-disable-next-line no-console
      console.log("[analyze-call] retrieval funnel:", {
        call_id: payload.callId,
        ...rerankStats,
      });

      // Persist the snapshot so /admin/observability + the per-call inset can
      // show what Claude was given. Best-effort; never blocks the analysis.
      void recordCallAnalysisInput({
        call_id: payload.callId,
        query_text: embeddingText,
        vector_hits: rerankStats.vector_hits,
        fts_hits: rerankStats.fts_hits,
        fused_candidates: rerankStats.fused_candidates,
        rerank_kept: rerankStats.rerank_kept,
        rerank_dropped: rerankStats.rerank_dropped_below_threshold,
        rerank_fallback_used: rerankStats.rerank_fallback_used,
        rerank_model: rerankStats.rerank_model || null,
        retrieved_chunks: retrievedLogs,
      });

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

      await upsertCallReport({
        call_id: payload.callId,
        model: result.model,
        prompt_version: result.prompt_version,
        report: result.report,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
      });

      // Mirror Claude usage into the unified model_usage ledger so /observability
      // can roll up tokens + cost across all providers for a calendar month.
      void recordModelUsage({
        provider: "anthropic",
        kind: "llm",
        model: result.model,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        tokens: result.input_tokens + result.output_tokens,
        cost_usd: costForLlm(
          result.model,
          result.input_tokens,
          result.output_tokens,
        ),
        scope: "analyze_call",
        scope_id: payload.callId,
      });

      await updateCallStatus(payload.callId, { process_status: "done" });

      return {
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        retrieved_reference_chunks: retrievedReferenceChunks.length,
        founder_videos: founderVideos.length,
      };
    } catch (err) {
      await updateCallStatus(payload.callId, {
        process_status: "failed",
        process_error: `analysis failed: ${formatError(err)}`,
      });
      throw err;
    }
  },
});
