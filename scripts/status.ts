import { supabaseAdmin } from "../services/supabase/client-admin";

async function main() {
const s = supabaseAdmin();
const { data: items } = await s
  .from("knowledge_items")
  .select("id, title, kind, process_status, process_error, duration_sec")
  .order("created_at", { ascending: false });

const summary: Record<string, number> = {};
for (const i of items ?? [])
  summary[i.process_status] = (summary[i.process_status] ?? 0) + 1;
console.log("STATUS SUMMARY:", summary);
console.log();
for (const i of items ?? []) {
  const err = i.process_error
    ? "  ERR=" + (i.process_error as string).slice(0, 80)
    : "";
  console.log(
    `  [${(i.process_status as string).padEnd(12)}] ${(i.kind as string).padEnd(15)} ${((i.title as string) || "").slice(0, 55).padEnd(57)}${err}`,
  );
}
const { count } = await s
  .from("knowledge_chunks")
  .select("*", { count: "exact", head: true });
console.log("\nTotal knowledge_chunks:", count);
}
main();
