// Re-run analyze locally with the new prompt + schema and PERSIST the result
// to call_reports. Use this when the worker deploy is slow/timing out.
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
import { upsertCallReport } from "../services/supabase/queries/call-reports";

async function runOne(callId: string) {
  console.log(`\n=== ${callId} ===`);
  const call = await getCall(callId);
  if (!call) throw new Error(`call not found: ${callId}`);
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

  const r = result.report as unknown as {
    summary?: {
      tldr?: string;
      outcome?: string;
      deal_health?: string;
      rep_performance_rubric?: Record<string, number>;
    };
    key_moments?: unknown[];
    rewrites?: unknown[];
    patterns?: unknown[];
  };
  console.log("model:", result.model, "prompt_v:", result.prompt_version);
  console.log("tokens:", result.input_tokens, "→", result.output_tokens);
  console.log("FIELDS:", {
    summary: !!r.summary,
    key_moments: Array.isArray(r.key_moments) ? r.key_moments.length : "MISSING",
    rewrites: Array.isArray(r.rewrites) ? r.rewrites.length : "MISSING",
    patterns: Array.isArray(r.patterns) ? r.patterns.length : "MISSING",
  });
  console.log("rubric keys:", Object.keys(r.summary?.rep_performance_rubric ?? {}));
  console.log("tldr:", r.summary?.tldr);

  const ok =
    !!r.summary &&
    Array.isArray(r.key_moments) && r.key_moments.length > 0 &&
    Array.isArray(r.rewrites) &&
    Array.isArray(r.patterns) && r.patterns.length > 0 &&
    Object.keys(r.summary?.rep_performance_rubric ?? {}).length === 5;

  if (!ok) {
    console.error("❌ QUALITY GATE FAILED — not saving");
    console.error("RAW SUMMARY:", JSON.stringify(r.summary, null, 2));
    console.error("RAW FIRST KEY_MOMENT:", JSON.stringify((r.key_moments as unknown[] | undefined)?.[0], null, 2));
    return false;
  }

  await upsertCallReport({
    call_id: callId,
    model: result.model,
    prompt_version: result.prompt_version,
    report: result.report,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
  });
  console.log("✅ saved to call_reports");
  return true;
}

(async () => {
  const callIds = process.argv.slice(2);
  if (!callIds.length) {
    console.error("usage: diag-rerun-and-save.ts <callId> [callId ...]");
    process.exit(1);
  }
  const MAX_ATTEMPTS = 4;
  let allOk = true;
  for (const id of callIds) {
    let saved = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`\n--- attempt ${attempt}/${MAX_ATTEMPTS} for ${id} ---`);
      try {
        const ok = await runOne(id);
        if (ok) {
          saved = true;
          break;
        }
      } catch (e) {
        console.error(`error on ${id} attempt ${attempt}:`, e);
      }
    }
    if (!saved) {
      console.error(`❌ FAILED after ${MAX_ATTEMPTS} attempts: ${id}`);
      allOk = false;
    }
  }
  process.exit(allOk ? 0 : 2);
})();
