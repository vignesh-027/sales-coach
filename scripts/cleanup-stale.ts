/**
 * Delete leftover SMOKE: / DEV TEST: rows from Supabase, including their
 * chunks/transcripts (ON DELETE CASCADE) and matching R2 objects.
 */
import { supabaseAdmin } from "../services/supabase/client-admin";
import { deleteR2Object } from "../services/r2/delete-object";

async function main() {
  const s = supabaseAdmin();
  const { data: items, error } = await s
    .from("knowledge_items")
    .select("id, title, media_r2_key")
    .or("title.ilike.SMOKE:%,title.ilike.DEV TEST:%");
  if (error) throw error;
  console.log(`Found ${items?.length ?? 0} stale rows.`);
  for (const it of items ?? []) {
    try {
      await deleteR2Object(it.media_r2_key as string);
      console.log(`  R2 deleted: ${it.media_r2_key}`);
    } catch (err) {
      console.warn(
        `  R2 delete failed (continuing): ${it.media_r2_key}`,
        err instanceof Error ? err.message : err,
      );
    }
    const { error: dErr } = await s
      .from("knowledge_items")
      .delete()
      .eq("id", it.id);
    if (dErr) throw dErr;
    console.log(`  Supabase row deleted: ${(it.title as string).slice(0, 50)}`);
  }
  console.log("cleanup done.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
