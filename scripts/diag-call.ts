import { supabaseAdmin } from "../services/supabase/client-admin";

const callId = process.argv[2];
if (!callId) {
  console.error("usage: tsx scripts/diag-call.ts <callId>");
  process.exit(1);
}

(async () => {
  const s = supabaseAdmin();

  const { data: recs } = await s
    .from("call_recordings")
    .select("id, recording_index, duration_sec")
    .eq("call_id", callId);
  console.log("RECORDINGS:", recs);

  const { data: tx } = await s
    .from("call_transcripts")
    .select("call_recording_id, full_text, segments")
    .eq("call_id", callId);
  console.log(
    "TRANSCRIPTS:",
    tx?.map((t) => ({
      rec: t.call_recording_id,
      chars: t.full_text?.length,
      segments: (t.segments as unknown[] | null)?.length,
    })),
  );

  const { data: ai } = await s
    .from("call_analysis_inputs")
    .select("*")
    .eq("call_id", callId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (ai && ai[0]) {
    const a = ai[0] as Record<string, unknown>;
    const chunks = (a.retrieved_chunks ?? []) as Array<{ kept: boolean }>;
    console.log("ANALYSIS_INPUT:", {
      vector_hits: a.vector_hits,
      fts_hits: a.fts_hits,
      fused: a.fused_candidates,
      rerank_kept: a.rerank_kept,
      rerank_dropped: a.rerank_dropped,
      fallback: a.rerank_fallback_used,
      model: a.rerank_model,
      query_chars: (a.query_text as string | null)?.length,
      retrieved_chunks_count: chunks.length,
      kept_chunks: chunks.filter((c) => c.kept).length,
    });
  } else {
    console.log("ANALYSIS_INPUT: (none)");
  }

  const { data: kb } = await s
    .from("knowledge_items")
    .select("id, kind, title, process_status");
  const by: Record<string, number> = {};
  for (const i of kb ?? []) {
    const key = `${(i as { kind: string }).kind}/${(i as { process_status: string }).process_status}`;
    by[key] = (by[key] ?? 0) + 1;
  }
  console.log("KNOWLEDGE_ITEMS_BY_KIND_STATUS:", by);

  const { count: kcCount } = await s
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true });
  console.log("KNOWLEDGE_CHUNKS_TOTAL:", kcCount);

  const { data: rep } = await s
    .from("call_reports")
    .select("report")
    .eq("call_id", callId)
    .single();
  const r = rep?.report as {
    summary?: { tldr?: string };
    key_moments?: unknown[];
    rewrites?: unknown[];
    patterns?: unknown[];
  };
  console.log("REPORT_TLDR:", r?.summary?.tldr);
  console.log("REPORT_COUNTS:", {
    key_moments: r?.key_moments?.length ?? 0,
    rewrites: r?.rewrites?.length ?? 0,
    patterns: r?.patterns?.length ?? 0,
  });
})();
