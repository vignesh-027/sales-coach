import { supabaseAdmin } from "../client-admin";

export interface RetrievedChunkLog {
  source: "call" | "knowledge";
  chunk_id?: string | null;
  parent_id: string;
  parent_title: string;
  snippet: string;
  vector_rank: number | null;
  fts_rank: number | null;
  fused_score: number | null;
  rerank_score: number | null;
  kept: boolean;
}

export interface CallAnalysisInputInsert {
  call_id: string;
  query_text: string;
  vector_hits: number;
  fts_hits: number;
  fused_candidates: number;
  rerank_kept: number;
  rerank_dropped: number;
  rerank_fallback_used: boolean;
  rerank_model: string | null;
  retrieved_chunks: RetrievedChunkLog[];
}

export async function recordCallAnalysisInput(
  row: CallAnalysisInputInsert,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from("call_analysis_inputs")
      .insert(row);
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[call-analysis-inputs] insert failed:", error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[call-analysis-inputs] insert threw:", e);
  }
}

export interface CallAnalysisInputRow {
  id: string;
  call_id: string;
  created_at: string;
  query_text: string | null;
  vector_hits: number;
  fts_hits: number;
  fused_candidates: number;
  rerank_kept: number;
  rerank_dropped: number;
  rerank_fallback_used: boolean;
  rerank_model: string | null;
  retrieved_chunks: RetrievedChunkLog[];
}

export async function getLatestCallAnalysisInput(
  callId: string,
): Promise<CallAnalysisInputRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("call_analysis_inputs")
    .select(
      "id, call_id, created_at, query_text, vector_hits, fts_hits, fused_candidates, rerank_kept, rerank_dropped, rerank_fallback_used, rerank_model, retrieved_chunks",
    )
    .eq("call_id", callId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as CallAnalysisInputRow | null) ?? null;
}

export interface RecentAnalysisRow {
  call_id: string;
  created_at: string;
  fused_candidates: number;
  rerank_kept: number;
  rerank_dropped: number;
  rerank_model: string | null;
}

export async function recentAnalyses(limit = 20): Promise<RecentAnalysisRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("call_analysis_inputs")
    .select(
      "call_id, created_at, fused_candidates, rerank_kept, rerank_dropped, rerank_model",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as RecentAnalysisRow[];
}

export interface AnalysisAverages {
  sample_size: number;
  avg_fused_candidates: number;
  avg_kept: number;
  avg_dropped: number;
}

export async function analysisAveragesLastNDays(
  days: number,
): Promise<AnalysisAverages> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("call_analysis_inputs")
    .select("fused_candidates, rerank_kept, rerank_dropped")
    .gte("created_at", since);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) {
    return {
      sample_size: 0,
      avg_fused_candidates: 0,
      avg_kept: 0,
      avg_dropped: 0,
    };
  }
  const sum = rows.reduce(
    (acc, r) => {
      acc.fused += r.fused_candidates ?? 0;
      acc.kept += r.rerank_kept ?? 0;
      acc.dropped += r.rerank_dropped ?? 0;
      return acc;
    },
    { fused: 0, kept: 0, dropped: 0 },
  );
  return {
    sample_size: rows.length,
    avg_fused_candidates: sum.fused / rows.length,
    avg_kept: sum.kept / rows.length,
    avg_dropped: sum.dropped / rows.length,
  };
}

export async function firstAnalysisCreatedAt(): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("call_analysis_inputs")
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.created_at ?? null;
}

export interface KnowledgeItemUsage {
  knowledge_item_id: string;
  appearances: number;
  kept_count: number;
  dropped_count: number;
  last_used_at: string | null;
}

export async function getKnowledgeItemUsage(
  knowledgeItemId: string,
): Promise<KnowledgeItemUsage | null> {
  const { data, error } = await supabaseAdmin()
    .from("knowledge_item_usage_v")
    .select("knowledge_item_id, appearances, kept_count, dropped_count, last_used_at")
    .eq("knowledge_item_id", knowledgeItemId)
    .maybeSingle();
  if (error) throw error;
  return (data as KnowledgeItemUsage | null) ?? null;
}
