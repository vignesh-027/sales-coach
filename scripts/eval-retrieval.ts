// Manual retrieval-quality eval.
//
// Runs each seeded query through the live hybrid + rerank path (the same
// helpers analyze-call uses) against the real Supabase DB. No assertions —
// it prints a per-query table + a summary so you can eyeball quality.
//
// Run: `npx tsx --env-file=.env.local scripts/eval-retrieval.ts`
// Cost: ~$0.001 per full run.

import { readFileSync } from "fs";
import { resolve } from "path";
import { embedBatch } from "../services/voyage/embed";
import { rerank } from "../services/voyage/rerank";
import { hybridSearchKnowledge } from "../services/supabase/queries/knowledge-chunks";
import { supabaseAdmin } from "../services/supabase/client-admin";
import { getRerankModel } from "../services/supabase/queries/app-settings";
import { buildSearchQuery } from "../services/voyage/build-search-query";
import { formatError } from "../services/format-error";

interface SeedQuery {
  id: string;
  query: string;
}

const POOL = 50;
const TOP_K = 10;

async function resolveTitles(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin()
    .from("knowledge_items")
    .select("id, title")
    .in("id", ids);
  return new Map((data ?? []).map((r) => [r.id as string, r.title as string]));
}

async function runOne(seed: SeedQuery, rerankModel: string) {
  const { embeddingText, ftsText } = buildSearchQuery(seed.query);
  const [qVec] = await embedBatch([embeddingText], {
    inputType: "query",
    scope: "eval_retrieval",
  });
  const hits = await hybridSearchKnowledge(qVec, ftsText, POOL);
  if (hits.length === 0) {
    return { seed, kept: [], topScore: 0, dropped: 0, fallback: false };
  }
  const r = await rerank(
    ftsText,
    hits.map((h) => h.chunk_text),
    { model: rerankModel, topK: TOP_K, scope: "eval_retrieval" },
  );
  const titleMap = await resolveTitles(
    Array.from(new Set(r.hits.map((rh) => hits[rh.index].knowledge_item_id))),
  );
  const kept = r.hits.map((rh) => {
    const h = hits[rh.index];
    return {
      title: titleMap.get(h.knowledge_item_id) ?? "(unknown)",
      vector_rank: h.vector_rank,
      fts_rank: h.fts_rank,
      fused_score: Number(h.fused_score?.toFixed(4) ?? 0),
      rerank_score: Number(rh.score.toFixed(4)),
      snippet: h.chunk_text.replace(/\s+/g, " ").slice(0, 80),
    };
  });
  return {
    seed,
    kept,
    topScore: kept[0]?.rerank_score ?? 0,
    dropped: r.dropped_below_threshold,
    fallback: r.fallback_used,
  };
}

async function main() {
  const seedsPath = resolve(process.cwd(), "scripts/eval-queries.json");
  const seeds = JSON.parse(readFileSync(seedsPath, "utf-8")) as SeedQuery[];
  const rerankModel = await getRerankModel();

  console.log(`\n=== Retrieval eval — ${seeds.length} queries, reranker=${rerankModel} ===\n`);

  const results: Array<Awaited<ReturnType<typeof runOne>>> = [];
  for (const seed of seeds) {
    try {
      const r = await runOne(seed, rerankModel);
      results.push(r);
      console.log(`\n[${seed.id}] "${seed.query}"`);
      console.log(
        `  kept ${r.kept.length} · dropped ${r.dropped}${r.fallback ? " · (fallback used)" : ""} · top score ${r.topScore.toFixed(4)}`,
      );
      r.kept.forEach((k, i) => {
        console.log(
          `   ${String(i + 1).padStart(2, " ")}. score=${k.rerank_score.toFixed(4)} v=${k.vector_rank || "-"} f=${k.fts_rank || "-"} fused=${k.fused_score.toFixed(4)} :: ${k.title}`,
        );
        console.log(`       "${k.snippet}…"`);
      });
    } catch (err) {
      console.log(`\n[${seed.id}] FAILED: ${formatError(err)}`);
    }
  }

  console.log("\n=== Summary ===");
  const okResults = results.filter((r) => r.kept.length > 0);
  const avgTop = okResults.length
    ? okResults.reduce((s, r) => s + r.topScore, 0) / okResults.length
    : 0;
  const avgKept = okResults.length
    ? okResults.reduce((s, r) => s + r.kept.length, 0) / okResults.length
    : 0;
  console.log(`  queries: ${seeds.length}`);
  console.log(`  non-empty: ${okResults.length}`);
  console.log(`  avg top-1 rerank score: ${avgTop.toFixed(4)}`);
  console.log(`  avg kept per query: ${avgKept.toFixed(2)}`);
  console.log(`  fallbacks fired: ${results.filter((r) => r.fallback).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
