import { supabaseAdmin } from "../services/supabase/client-admin";
import { signedGetUrl } from "../services/r2/signed-url";

async function main() {
  const s = supabaseAdmin();
  const { data: it } = await s
    .from("knowledge_items")
    .select("id, title, media_r2_key, duration_sec")
    .eq("id", "5bf88318-d46b-4483-9474-8378656c0195")
    .single();
  console.log(`item: ${it!.title}`);
  console.log(`  r2 key: ${it!.media_r2_key}`);
  console.log(`  duration_sec stored: ${it!.duration_sec}`);

  const url = await signedGetUrl(it!.media_r2_key as string, 300);
  const head = await fetch(url, { method: "HEAD" });
  console.log(`  R2 HEAD: ${head.status}`);
  console.log(`  Content-Length: ${head.headers.get("content-length")} bytes (${((+head.headers.get("content-length")!)/1024/1024).toFixed(2)} MB)`);
  console.log(`  Content-Type: ${head.headers.get("content-type")}`);
}
main().catch(e => { console.error(e); process.exit(1); });
