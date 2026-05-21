import { supabaseAdmin } from "../services/supabase/client-admin";
import { signedGetUrl } from "../services/r2/signed-url";

async function main() {
  const s = supabaseAdmin();
  const { data: it } = await s
    .from("knowledge_items")
    .select("id, title, media_r2_key, duration_sec")
    .eq("id", "5bf88318-d46b-4483-9474-8378656c0195")
    .single();
  const url = await signedGetUrl(it!.media_r2_key as string, 300);
  const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
  console.log(`  status=${res.status}`);
  console.log(`  Content-Range: ${res.headers.get("content-range")}`);
  console.log(`  Content-Length: ${res.headers.get("content-length")}`);
}
main().catch(e => { console.error(e); process.exit(1); });
