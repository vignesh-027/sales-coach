import { supabaseAdmin } from "../client-admin";

export interface CallChunkRow {
  call_id: string;
  call_recording_id: string;
  chunk_index: number;
  chunk_text: string;
  start_ts_ms: number | null;
  end_ts_ms: number | null;
  embedding: number[];
}

export async function bulkInsertCallChunks(rows: CallChunkRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin()
    .from("call_chunks")
    .upsert(rows, { onConflict: "call_id,chunk_index" });
  if (error) throw error;
}

export async function deleteCallChunks(callId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("call_chunks")
    .delete()
    .eq("call_id", callId);
  if (error) throw error;
}

export interface CallHybridHit {
  call_id: string;
  call_recording_id: string;
  chunk_index: number;
  chunk_text: string;
  start_ts_ms: number | null;
  end_ts_ms: number | null;
  distance: number | null;
  vector_rank: number;
  fts_rank: number;
  fused_score: number;
}

export async function hybridSearchCallChunks(
  queryEmbedding: number[],
  queryText: string,
  limit = 50,
  callId?: string,
): Promise<CallHybridHit[]> {
  const { data, error } = await supabaseAdmin().rpc(
    "call_chunks_hybrid_search",
    {
      query_embedding: queryEmbedding,
      query_text: queryText,
      match_count: limit,
      p_call_id: callId ?? null,
    },
  );
  if (error) throw error;
  return (data ?? []) as CallHybridHit[];
}

export async function getCallChunkStats(
  callId: string,
): Promise<{ chunks_total: number } | null> {
  const { count, error } = await supabaseAdmin()
    .from("call_chunks")
    .select("id", { count: "exact", head: true })
    .eq("call_id", callId);
  if (error) throw error;
  return { chunks_total: count ?? 0 };
}
