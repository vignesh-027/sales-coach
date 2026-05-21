import { supabaseAdmin } from "../services/supabase/client-admin";
async function main() {
  const s = supabaseAdmin();
  const { data: it } = await s
    .from("knowledge_items")
    .select("id, title, kind, source_format, media_type, process_status, process_error, media_r2_key")
    .eq("title", "Business Details").maybeSingle();
  console.log("item:", it);
  if (!it) return;
  const { data: tr } = await s.from("transcripts").select("full_text").eq("knowledge_item_id", (it as any).id).maybeSingle();
  console.log("transcript chars:", (tr as any)?.full_text?.length ?? 0);
  console.log("transcript first 200 chars:", (tr as any)?.full_text?.slice(0, 200));
}
main().catch(e => { console.error(e); process.exit(1); });
