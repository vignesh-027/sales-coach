/**
 * One-shot: embed the `Business Details` knowledge item that's stuck in
 * `failed` from the old Gemini-era 429. The transcript text is already in
 * the DB; we just need to chunk → embed → insert → mark done.
 *
 * The file is large (~3.6 MB, ~7K chunks). To stay under Voyage's free-tier
 * 10K TPM cap, this script sub-batches at 20 chunks per request and sleeps
 * 21s between requests. Expected runtime ~25 min on free tier; <1 min on
 * paid (set VOYAGE_THROTTLE_MS=0 and SUBBATCH=128 to disable throttling).
 *
 *   npx tsx --env-file=.env.local scripts/embed-business-details.ts
 *
 * Idempotent: skips if chunks already exist.
 */
import { supabaseAdmin } from "../services/supabase/client-admin";
import { VOYAGE_EMBEDDING_MODEL, VOYAGE_EMBEDDING_DIM, type VoyageEmbedResponse } from "../services/voyage/client";
import { chunkText } from "../lib/chunker";
import { bulkInsertChunks } from "../services/supabase/queries/knowledge-chunks";
import { getTranscript } from "../services/supabase/queries/transcripts";
import { updateKnowledgeStatus } from "../services/supabase/queries/knowledge-items";

const VOYAGE_KEY =
  process.env.Voyage_API_Key ??
  process.env.VOYAGE_API_KEY ??
  process.env.VOYAGEAI_API_KEY;
if (!VOYAGE_KEY) throw new Error("Missing Voyage_API_Key in env");

const TITLE = "Business Details";
const SUBBATCH = Number(process.env.VOYAGE_SUBBATCH ?? 20);
const THROTTLE_MS = Number(process.env.VOYAGE_THROTTLE_MS ?? 21_000);

const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

async function embedSubBatch(texts: string[]): Promise<number[][]> {
  // Inline raw fetch so we own the 429 path (the shared voyageFetch helper
  // throws on non-2xx and would skip our retry logic).
  const MAX_ATTEMPTS = 8;
  let attempt = 0;
  while (true) {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${VOYAGE_KEY}`,
      },
      body: JSON.stringify({
        input: texts,
        model: VOYAGE_EMBEDDING_MODEL,
        input_type: "document",
        output_dimension: VOYAGE_EMBEDDING_DIM,
        truncation: true,
      }),
    });
    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const ra = Number(res.headers.get("retry-after"));
      // Free tier resets the 3-RPM window roughly each minute; bias backoff
      // toward 60s+ once the simple short delays don't clear it.
      const wait =
        Number.isFinite(ra) && ra > 0
          ? ra * 1000
          : Math.min(120_000, 15_000 * Math.pow(2, attempt));
      console.warn(
        `  429; retry ${attempt + 1}/${MAX_ATTEMPTS} after ${Math.round(wait / 1000)}s`,
      );
      try { await res.text(); } catch { /* drain */ }
      await sleep(wait);
      attempt++;
      continue;
    }
    if (!res.ok) {
      throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as VoyageEmbedResponse;
    return [...data.data]
      .sort((a, b) => a.index - b.index)
      .map((e) => e.embedding);
  }
}

async function main(): Promise<void> {
  const s = supabaseAdmin();
  const { data: it } = await s
    .from("knowledge_items")
    .select("id, title, process_status, source_format")
    .eq("title", TITLE)
    .maybeSingle();
  if (!it) throw new Error(`No knowledge item titled "${TITLE}"`);
  const item = it as { id: string; title: string; process_status: string; source_format: string };
  console.log(`item ${item.id} · status=${item.process_status} · format=${item.source_format}`);

  const { count: existing } = await s
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("knowledge_item_id", item.id);
  if ((existing ?? 0) > 0) {
    console.log(`already has ${existing} chunks — nothing to do`);
    return;
  }

  const t = await getTranscript(item.id);
  if (!t?.full_text) throw new Error("no transcript text");
  console.log(`transcript: ${t.full_text.length} chars`);

  const chunks = chunkText(t.full_text);
  console.log(`chunked into ${chunks.length} pieces · sub-batching ${SUBBATCH}/request · throttle ${THROTTLE_MS}ms`);
  const totalRequests = Math.ceil(chunks.length / SUBBATCH);

  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += SUBBATCH) {
    const slice = chunks.slice(i, i + SUBBATCH).map((c) => c.text);
    const reqIdx = Math.floor(i / SUBBATCH) + 1;
    process.stdout.write(`  [${reqIdx}/${totalRequests}] embedding ${slice.length} chunks… `);
    const vecs = await embedSubBatch(slice);
    if (vecs[0]?.length !== VOYAGE_EMBEDDING_DIM) {
      throw new Error(`got ${vecs[0]?.length}-d vector, expected ${VOYAGE_EMBEDDING_DIM}`);
    }
    vectors.push(...vecs);
    console.log("ok");
    if (i + SUBBATCH < chunks.length) await sleep(THROTTLE_MS);
  }

  console.log(`inserting ${vectors.length} chunks…`);
  await bulkInsertChunks(
    chunks.map((c, i) => ({
      knowledge_item_id: item.id,
      chunk_index: i,
      chunk_text: c.text,
      start_ts_ms: null,
      end_ts_ms: null,
      embedding: vectors[i],
    })),
  );

  await updateKnowledgeStatus(item.id, {
    process_status: "done",
    process_error: null,
  });

  console.log(`done. status=done, ${vectors.length} chunks at ${VOYAGE_EMBEDDING_DIM}-d`);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
