/**
 * Bulk re-embed every existing done knowledge_item and call using the new
 * Voyage embedding model. Run once, after applying migration 0007.
 *
 * Usage: npx tsx --env-file=.env.local scripts/voyage-reembed-all.ts
 *
 * Idempotent: bulkInsertChunks / bulkInsertCallChunks both upsert on
 * (knowledge_item_id, chunk_index) / (call_id, chunk_index), so re-running
 * is safe if the script fails halfway.
 *
 * Source data preserved: this script only re-creates `knowledge_chunks` and
 * `call_chunks` rows from existing transcripts. It does NOT touch source
 * files in R2, transcripts, knowledge_items, calls, or call_recordings.
 *
 * Delete this script after a successful run + verification.
 */
import { supabaseAdmin } from "../services/supabase/client-admin";
import { embedBatch } from "../services/voyage/embed";
import { chunkTranscript, chunkText } from "../lib/chunker";
import { bulkInsertChunks } from "../services/supabase/queries/knowledge-chunks";
import { bulkInsertCallChunks } from "../services/supabase/queries/call-chunks";
import { getTranscript } from "../services/supabase/queries/transcripts";
import { listCallTranscriptsOrdered } from "../services/supabase/queries/call-transcripts";

const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

// Voyage list price: $0.12 per 1M tokens for voyage-4-large (as of plan
// validation). We don't get token counts back from our batched call (the
// service module discards usage), so we approximate as 1 token ≈ 4 chars.
const PRICE_PER_MTOK = 0.12;
const CHARS_PER_TOKEN = 4;

// Throttle between items so the free tier (3 RPM / 10K TPM) doesn't 429 us.
// Voyage's standard tier (with a payment method on file) is 2000 RPM — at
// that point you can set THROTTLE_MS=0 to run flat-out. The script's
// per-item embedBatch already has 429 retry-with-backoff, this just keeps
// us from hammering the limit in the first place.
const THROTTLE_MS = Number(process.env.VOYAGE_THROTTLE_MS ?? 21_000);

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

interface Tally {
  items_processed: number;
  chunks_inserted: number;
  approx_tokens: number;
  failures: number;
}

async function reembedKnowledge(): Promise<Tally> {
  const s = supabaseAdmin();
  const { data, error } = await s
    .from("knowledge_items")
    .select("id, title, source_format")
    .eq("process_status", "done");
  if (error) throw error;
  const items = (data ?? []) as Array<{
    id: string;
    title: string;
    source_format: "audio" | "video" | "text";
  }>;

  const tally: Tally = {
    items_processed: 0,
    chunks_inserted: 0,
    approx_tokens: 0,
    failures: 0,
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    process.stdout.write(
      `[${i + 1}/${items.length}] ${DIM}knowledge${RESET} [${item.source_format}] ${item.title.slice(0, 50)}… `,
    );
    // Skip items that already have chunks — makes the script idempotent and
    // cheap to re-run after a partial-failure run on the free tier.
    const { count: existing } = await s
      .from("knowledge_chunks")
      .select("id", { count: "exact", head: true })
      .eq("knowledge_item_id", item.id);
    if ((existing ?? 0) > 0) {
      console.log(`${DIM}already has ${existing} chunks · skip${RESET}`);
      continue;
    }
    try {
      const t = await getTranscript(item.id);
      if (!t) {
        console.log(`${RED}no transcript, skip${RESET}`);
        tally.failures += 1;
        continue;
      }
      const chunks =
        item.source_format === "text"
          ? chunkText(t.full_text)
          : chunkTranscript(t.segments);
      if (chunks.length === 0) {
        console.log(`${RED}no chunks${RESET}`);
        tally.failures += 1;
        continue;
      }
      const charTotal = chunks.reduce((n, c) => n + c.text.length, 0);
      const vectors = await embedBatch(chunks.map((c) => c.text));
      await bulkInsertChunks(
        chunks.map((c, i) => ({
          knowledge_item_id: item.id,
          chunk_index: i,
          chunk_text: c.text,
          start_ts_ms: item.source_format === "text" ? null : c.start_ts_ms,
          end_ts_ms: item.source_format === "text" ? null : c.end_ts_ms,
          embedding: vectors[i],
        })),
      );
      tally.items_processed += 1;
      tally.chunks_inserted += chunks.length;
      tally.approx_tokens += Math.ceil(charTotal / CHARS_PER_TOKEN);
      console.log(`${GREEN}${chunks.length} chunks${RESET}`);
    } catch (e) {
      tally.failures += 1;
      console.log(`${RED}FAIL: ${e instanceof Error ? e.message : String(e)}${RESET}`);
    }
    // Respect free-tier 3 RPM cap. Set VOYAGE_THROTTLE_MS=0 once you've
    // added a payment method on the Voyage dashboard.
    if (i < items.length - 1) await sleep(THROTTLE_MS);
  }
  return tally;
}

async function reembedCalls(): Promise<Tally> {
  const s = supabaseAdmin();
  const { data, error } = await s
    .from("calls")
    .select("id, title")
    .eq("process_status", "done");
  if (error) throw error;
  const calls = (data ?? []) as Array<{ id: string; title: string }>;

  const tally: Tally = {
    items_processed: 0,
    chunks_inserted: 0,
    approx_tokens: 0,
    failures: 0,
  };

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    process.stdout.write(
      `[${i + 1}/${calls.length}] ${DIM}call${RESET} ${call.title.slice(0, 50)}… `,
    );
    const { count: existing } = await s
      .from("call_chunks")
      .select("id", { count: "exact", head: true })
      .eq("call_id", call.id);
    if ((existing ?? 0) > 0) {
      console.log(`${DIM}already has ${existing} chunks · skip${RESET}`);
      continue;
    }
    try {
      const transcripts = await listCallTranscriptsOrdered(call.id);
      if (transcripts.length === 0) {
        console.log(`${RED}no transcripts${RESET}`);
        tally.failures += 1;
        continue;
      }
      const allChunks: Array<{
        recording_id: string;
        text: string;
        start_ts_ms: number;
        end_ts_ms: number;
      }> = [];
      for (const t of transcripts) {
        for (const c of chunkTranscript(t.segments)) {
          allChunks.push({
            recording_id: t.call_recording_id,
            text: c.text,
            start_ts_ms: c.start_ts_ms,
            end_ts_ms: c.end_ts_ms,
          });
        }
      }
      if (allChunks.length === 0) {
        console.log(`${RED}no chunks${RESET}`);
        tally.failures += 1;
        continue;
      }
      const charTotal = allChunks.reduce((n, c) => n + c.text.length, 0);
      const vectors = await embedBatch(allChunks.map((c) => c.text));
      await bulkInsertCallChunks(
        allChunks.map((c, i) => ({
          call_id: call.id,
          call_recording_id: c.recording_id,
          chunk_index: i,
          chunk_text: c.text,
          start_ts_ms: c.start_ts_ms,
          end_ts_ms: c.end_ts_ms,
          embedding: vectors[i],
        })),
      );
      tally.items_processed += 1;
      tally.chunks_inserted += allChunks.length;
      tally.approx_tokens += Math.ceil(charTotal / CHARS_PER_TOKEN);
      console.log(`${GREEN}${allChunks.length} chunks${RESET}`);
    } catch (e) {
      tally.failures += 1;
      console.log(`${RED}FAIL: ${e instanceof Error ? e.message : String(e)}${RESET}`);
    }
    if (i < calls.length - 1) await sleep(THROTTLE_MS);
  }
  return tally;
}

async function main(): Promise<void> {
  console.log("=== voyage-reembed-all ===");
  console.log("knowledge items:");
  const k = await reembedKnowledge();
  console.log("\ncalls:");
  const c = await reembedCalls();

  const totalTokens = k.approx_tokens + c.approx_tokens;
  const totalCost = (totalTokens / 1_000_000) * PRICE_PER_MTOK;

  console.log("\n=== summary ===");
  console.log(`knowledge items processed: ${k.items_processed}  failures: ${k.failures}`);
  console.log(`knowledge chunks inserted: ${k.chunks_inserted}`);
  console.log(`calls processed:           ${c.items_processed}  failures: ${c.failures}`);
  console.log(`call chunks inserted:      ${c.chunks_inserted}`);
  console.log(`approx tokens:             ${totalTokens.toLocaleString()}`);
  console.log(`approx cost (USD):         $${totalCost.toFixed(4)}`);
  if (k.failures + c.failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
