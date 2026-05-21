import { supabaseAdmin } from "../services/supabase/client-admin";

async function main() {
  const s = supabaseAdmin();
  const { data: items } = await s
    .from("knowledge_items")
    .select("id, title, process_status, process_error, duration_sec, media_type, created_at")
    .order("created_at", { ascending: false })
    .limit(3);
  for (const it of items ?? []) {
    console.log(`\n=== ${it.title} ===`);
    console.log(`  id: ${it.id}`);
    console.log(`  created: ${it.created_at}`);
    console.log(`  status: ${it.process_status}`);
    console.log(`  duration_sec: ${it.duration_sec}`);
    console.log(`  media_type: ${it.media_type}`);
    console.log(`  process_error: ${it.process_error}`);

    const { data: tr } = await s
      .from("transcripts")
      .select("full_text, segments")
      .eq("knowledge_item_id", it.id)
      .maybeSingle();
    if (tr) {
      const segs = (tr.segments as Array<{ start_ms: number; end_ms: number; text: string }>) ?? [];
      const lastEnd = segs.length ? segs[segs.length - 1].end_ms : 0;
      console.log(`  transcript: ${tr.full_text?.length ?? 0} chars · ${segs.length} segments · last end_ms=${lastEnd} (${(lastEnd/60000).toFixed(2)} min)`);
    } else {
      console.log(`  transcript: none`);
    }
    const { count } = await s.from("knowledge_chunks").select("id", { count: "exact", head: true }).eq("knowledge_item_id", it.id);
    console.log(`  chunks: ${count}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
