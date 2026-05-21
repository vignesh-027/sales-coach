import { supabaseAdmin } from "../services/supabase/client-admin";

async function main() {
  const s = supabaseAdmin();

  // Knowledge items
  const { data: items } = await s
    .from("knowledge_items")
    .select("id, title, process_status")
    .order("created_at", { ascending: false });

  console.log(`\n=== KNOWLEDGE ITEMS (${items?.length ?? 0}) ===`);
  let kWith = 0, kWithout = 0;
  for (const it of items ?? []) {
    const { count } = await s
      .from("knowledge_chunks")
      .select("id", { count: "exact", head: true })
      .eq("knowledge_item_id", it.id);
    const has = (count ?? 0) > 0;
    if (has) kWith++; else kWithout++;
    console.log(`  ${has ? "✓" : "✗"} [${it.process_status}] ${count ?? 0} chunks · ${(it.title as string).slice(0, 60)}`);
  }
  console.log(`  totals: ${kWith} with chunks, ${kWithout} missing chunks`);

  // Calls
  const { data: calls } = await s
    .from("calls")
    .select("id, title, process_status")
    .order("created_at", { ascending: false });

  console.log(`\n=== CALLS (${calls?.length ?? 0}) ===`);
  let cWith = 0, cWithout = 0;
  for (const c of calls ?? []) {
    const { count } = await s
      .from("call_chunks")
      .select("id", { count: "exact", head: true })
      .eq("call_id", c.id);
    const has = (count ?? 0) > 0;
    if (has) cWith++; else cWithout++;
    console.log(`  ${has ? "✓" : "✗"} [${c.process_status}] ${count ?? 0} chunks · ${(c.title as string).slice(0, 60)}`);
  }
  console.log(`  totals: ${cWith} with chunks, ${cWithout} missing chunks`);

  // Verify dimension on a sample
  const { data: kSample } = await s
    .from("knowledge_chunks")
    .select("embedding")
    .limit(1);
  const { data: cSample } = await s
    .from("call_chunks")
    .select("embedding")
    .limit(1);
  const parseDim = (v: unknown) => {
    if (typeof v === "string") return v.split(",").length;
    if (Array.isArray(v)) return v.length;
    return "?";
  };
  console.log(`\n=== DIMENSION CHECK ===`);
  console.log(`  knowledge_chunks sample dim: ${kSample?.[0] ? parseDim(kSample[0].embedding) : "no rows"}`);
  console.log(`  call_chunks sample dim:      ${cSample?.[0] ? parseDim(cSample[0].embedding) : "no rows"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
