import { NextResponse } from "next/server";
import { embedBatch } from "@/services/voyage/embed";
import { rerank } from "@/services/voyage/rerank";
import {
  hybridSearchKnowledge,
  type KnowledgeKind,
} from "@/services/supabase/queries/knowledge-chunks";
import { supabaseAdmin } from "@/services/supabase/client-admin";
import { getRerankModel } from "@/services/supabase/queries/app-settings";
import { buildSearchQuery } from "@/services/voyage/build-search-query";

export const runtime = "nodejs";

interface Body {
  query: string;
  match_count?: number;
  kinds?: KnowledgeKind[];
}

const CANDIDATE_POOL_SIZE = 50;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const q = (body.query ?? "").trim();
  if (!q) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  const matchCount = Math.min(Math.max(body.match_count ?? 5, 1), 20);
  // All three kinds eligible by default — text_document was previously filtered
  // out, which silently excluded uploaded playbooks from search.
  const kinds: KnowledgeKind[] = body.kinds ?? [
    "founder_video",
    "reference_call",
    "text_document",
  ];

  const { embeddingText, ftsText } = buildSearchQuery(q);

  let qVec: number[];
  try {
    [qVec] = await embedBatch([embeddingText], {
      inputType: "query",
      scope: "knowledge_search",
    });
  } catch (e) {
    console.error("[search] embed failed:", e);
    return NextResponse.json(
      { error: `embed failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  let hits;
  try {
    hits = await hybridSearchKnowledge(qVec, ftsText, CANDIDATE_POOL_SIZE, kinds);
  } catch (e) {
    console.error("[search] hybrid rpc failed:", e);
    return NextResponse.json(
      {
        error: `rpc knowledge_chunks_hybrid_search failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 500 },
    );
  }
  const vectorHits = hits.filter((h) => h.vector_rank > 0).length;
  const ftsHits = hits.filter((h) => h.fts_rank > 0).length;

  let reranked: {
    hits: Array<{ index: number; score: number }>;
    fallback: boolean;
    dropped: number;
    model: string;
  } = { hits: [], fallback: false, dropped: 0, model: "" };
  if (hits.length > 0) {
    const rerankModel = await getRerankModel();
    const r = await rerank(
      ftsText,
      hits.map((h) => h.chunk_text),
      { model: rerankModel, topK: matchCount },
    );
    reranked = {
      hits: r.hits,
      fallback: r.fallback_used,
      dropped: r.dropped_below_threshold,
      model: r.model,
    };
  }

  const ids = Array.from(
    new Set(reranked.hits.map((rh) => hits[rh.index].knowledge_item_id)),
  );
  const s = supabaseAdmin();
  let titleMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: titles } = await s
      .from("knowledge_items")
      .select("id, title")
      .in("id", ids);
    titleMap = new Map(
      (titles ?? []).map((t) => [t.id as string, t.title as string]),
    );
  }

  // Dedupe by knowledge_item_id: collapse multiple matching chunks of the
  // same item to one result row, keeping the highest-scoring chunk. Since
  // reranked.hits is sorted by rerank_score desc, the first occurrence is the
  // best. Analyze-call retrieval intentionally does NOT dedupe — multiple
  // chunks of the same item add signal there. This is UI-search-only.
  const seenItems = new Set<string>();
  const results: Array<{
    knowledge_item_id: string;
    item_title: string;
    chunk_index: number;
    chunk_text: string;
    distance: number;
    vector_rank: number;
    fts_rank: number;
    fused_score: number;
    rerank_score: number;
  }> = [];
  for (const rh of reranked.hits) {
    const h = hits[rh.index];
    if (seenItems.has(h.knowledge_item_id)) continue;
    seenItems.add(h.knowledge_item_id);
    results.push({
      knowledge_item_id: h.knowledge_item_id,
      item_title: titleMap.get(h.knowledge_item_id) ?? "(unknown)",
      chunk_index: h.chunk_index,
      chunk_text: h.chunk_text,
      distance: h.distance,
      vector_rank: h.vector_rank,
      fts_rank: h.fts_rank,
      fused_score: h.fused_score,
      rerank_score: rh.score,
    });
  }

  return NextResponse.json({
    query_dim: qVec.length,
    candidate_count: hits.length,
    vector_hits: vectorHits,
    fts_hits: ftsHits,
    result_count: results.length,
    rerank_model: reranked.model,
    rerank_fallback_used: reranked.fallback,
    rerank_dropped_below_threshold: reranked.dropped,
    results,
  });
}
