import { supabaseAdmin } from "../client-admin";

export interface ChunkRow {
  knowledge_item_id: string;
  chunk_index: number;
  chunk_text: string;
  start_ts_ms: number | null;
  end_ts_ms: number | null;
  embedding: number[];
}

export async function bulkInsertChunks(rows: ChunkRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin()
    .from("knowledge_chunks")
    .upsert(rows, { onConflict: "knowledge_item_id,chunk_index" });
  if (error) throw error;
}

export async function deleteChunksFor(knowledgeItemId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("knowledge_chunks")
    .delete()
    .eq("knowledge_item_id", knowledgeItemId);
  if (error) throw error;
}

export interface SimilarityHit {
  knowledge_item_id: string;
  chunk_index: number;
  chunk_text: string;
  start_ts_ms: number | null;
  end_ts_ms: number | null;
  distance: number;
}

export type KnowledgeKind = "founder_video" | "reference_call" | "text_document";

export async function similaritySearch(
  queryEmbedding: number[],
  limit = 5,
  kinds?: KnowledgeKind[],
): Promise<SimilarityHit[]> {
  const { data, error } = await supabaseAdmin().rpc("knowledge_chunks_search", {
    query_embedding: queryEmbedding,
    match_count: limit,
    p_kinds: kinds && kinds.length > 0 ? kinds : null,
  });
  if (error) throw error;
  return (data ?? []) as SimilarityHit[];
}

export interface HybridHit extends SimilarityHit {
  vector_rank: number;
  fts_rank: number;
  fused_score: number;
}

export async function hybridSearchKnowledge(
  queryEmbedding: number[],
  queryText: string,
  limit = 50,
  kinds?: KnowledgeKind[],
): Promise<HybridHit[]> {
  const { data, error } = await supabaseAdmin().rpc(
    "knowledge_chunks_hybrid_search",
    {
      query_embedding: queryEmbedding,
      query_text: queryText,
      match_count: limit,
      p_kinds: kinds && kinds.length > 0 ? kinds : null,
    },
  );
  if (error) throw error;
  return (data ?? []) as HybridHit[];
}
