/**
 * Mark items that finished transcription but never got embeddings as `failed`
 * so they show the UI Retry button. The retry endpoints already do "smart
 * resume" — they skip transcription and go straight to embed (and on calls,
 * then to analyze).
 *
 * Targets: items with process_status='done' but zero rows in their chunks
 * table (the leftover stragglers from the Voyage re-embed migration that
 * hit the free-tier rate limit and never succeeded).
 *
 *   npx tsx --env-file=.env.local scripts/mark-stuck-failed.ts
 *
 * Idempotent: only updates items that match the "done but no chunks" pattern,
 * so re-running after some have actually finished re-embedding is safe.
 */
import { supabaseAdmin } from "../services/supabase/client-admin";

const ERR_MSG =
  "embedding failed during voyage re-embed (free-tier rate limit). Click Retry to resume from the embed step — no re-upload or re-transcription needed.";

async function main(): Promise<void> {
  const s = supabaseAdmin();

  // -------- knowledge_items --------
  const { data: kItems, error: kErr } = await s
    .from("knowledge_items")
    .select("id, title")
    .eq("process_status", "done");
  if (kErr) throw kErr;
  let kFlagged = 0;
  for (const it of (kItems ?? []) as Array<{ id: string; title: string }>) {
    const { count } = await s
      .from("knowledge_chunks")
      .select("id", { count: "exact", head: true })
      .eq("knowledge_item_id", it.id);
    if ((count ?? 0) > 0) continue;
    const { error } = await s
      .from("knowledge_items")
      .update({ process_status: "failed", process_error: ERR_MSG })
      .eq("id", it.id);
    if (error) {
      console.warn(`  ! could not flag ${it.title}: ${error.message}`);
      continue;
    }
    console.log(`  flagged knowledge: ${it.title}`);
    kFlagged++;
  }

  // -------- calls --------
  const { data: calls, error: cErr } = await s
    .from("calls")
    .select("id, title")
    .eq("process_status", "done");
  if (cErr) throw cErr;
  let cFlagged = 0;
  for (const c of (calls ?? []) as Array<{ id: string; title: string }>) {
    const { count } = await s
      .from("call_chunks")
      .select("id", { count: "exact", head: true })
      .eq("call_id", c.id);
    if ((count ?? 0) > 0) continue;
    const { error } = await s
      .from("calls")
      .update({ process_status: "failed", process_error: ERR_MSG })
      .eq("id", c.id);
    if (error) {
      console.warn(`  ! could not flag ${c.title}: ${error.message}`);
      continue;
    }
    console.log(`  flagged call: ${c.title}`);
    cFlagged++;
  }

  console.log(`\nsummary: ${kFlagged} knowledge + ${cFlagged} call(s) flagged as failed`);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
