// Voyage reranker.
//
// Cross-encoder pass that re-orders the candidate set produced by hybrid
// search before we hand it to Claude. The candidate pool is typically 50;
// we keep the top-K (default 10) and drop anything below the min-score
// threshold (default 0.3) to avoid feeding Claude weakly-relevant junk.
//
// If the threshold drops everything we fall back to the top-3 by rerank
// score regardless — the prompt should never be empty.

import { voyageFetch } from "./client";
import { DEFAULT_RERANK_MODEL } from "./rerank-models";
import { recordVoyageUsage } from "@/services/supabase/queries/voyage-usage";
import { costForRerank } from "./pricing";

interface VoyageRerankResponse {
  object: "list";
  data: Array<{
    index: number;
    relevance_score: number;
  }>;
  model: string;
  usage: { total_tokens: number };
}

export interface RerankHit {
  /** Original index into the `documents` array passed in. */
  index: number;
  /** Voyage relevance score, typically in [0, 1]. */
  score: number;
}

export interface RerankResult {
  hits: RerankHit[];
  model: string;
  tokens: number;
  dropped_below_threshold: number;
  fallback_used: boolean;
}

export interface RerankOptions {
  model?: string;
  topK?: number;
  minScore?: number;
  /** If the threshold strands everything, keep this many top-by-score anyway. */
  fallbackK?: number;
  /** Logical caller for observability. */
  scope?: string;
  scopeId?: string | null;
}

const DEFAULTS = {
  topK: 10,
  minScore: 0.3,
  fallbackK: 3,
};

export async function rerank(
  query: string,
  documents: string[],
  opts: RerankOptions = {},
): Promise<RerankResult> {
  const model = opts.model ?? DEFAULT_RERANK_MODEL;
  const topK = opts.topK ?? DEFAULTS.topK;
  const minScore = opts.minScore ?? DEFAULTS.minScore;
  const fallbackK = opts.fallbackK ?? DEFAULTS.fallbackK;

  if (documents.length === 0) {
    return {
      hits: [],
      model,
      tokens: 0,
      dropped_below_threshold: 0,
      fallback_used: false,
    };
  }

  const res = await voyageFetch("/rerank", {
    method: "POST",
    body: JSON.stringify({
      query,
      documents,
      model,
      top_k: Math.min(topK * 2, documents.length), // ask for a bit extra so threshold filtering has headroom
      truncation: true,
    }),
  });
  const data = (await res.json()) as VoyageRerankResponse;
  const tokens = data.usage?.total_tokens ?? 0;
  if (tokens > 0) {
    void recordVoyageUsage({
      kind: "rerank",
      model: data.model,
      tokens,
      cost_usd: costForRerank(data.model, tokens),
      scope: opts.scope ?? null,
      scope_id: opts.scopeId ?? null,
    });
  }
  const sorted = [...data.data].sort(
    (a, b) => b.relevance_score - a.relevance_score,
  );

  const aboveThreshold = sorted
    .filter((d) => d.relevance_score >= minScore)
    .slice(0, topK)
    .map((d) => ({ index: d.index, score: d.relevance_score }));

  let fallback_used = false;
  let hits: RerankHit[];
  if (aboveThreshold.length === 0) {
    fallback_used = true;
    hits = sorted
      .slice(0, fallbackK)
      .map((d) => ({ index: d.index, score: d.relevance_score }));
  } else {
    hits = aboveThreshold;
  }

  return {
    hits,
    model: data.model,
    tokens: data.usage?.total_tokens ?? 0,
    dropped_below_threshold: sorted.length - aboveThreshold.length,
    fallback_used,
  };
}
