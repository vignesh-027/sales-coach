import { supabaseAdmin } from "../services/supabase/client-admin";
import { tasks } from "../worker/client";
import type { EmbedTranscriptPayload } from "../worker/embed-transcript";

async function main() {
  const s = supabaseAdmin();
  const { data: items } = await s
    .from("knowledge_items")
    .select("id, title, process_status, process_error")
    .eq("process_status", "failed");

  console.log(`Found ${items?.length ?? 0} failed items`);
  for (const item of items ?? []) {
    const id = item.id as string;
    const title = item.title as string;
    // reset to 'embedding' and retrigger
    await s
      .from("knowledge_items")
      .update({ process_status: "embedding", process_error: null })
      .eq("id", id);
    const payload: EmbedTranscriptPayload = { knowledgeItemId: id };
    const handle = await tasks.trigger<
      typeof import("../worker/embed-transcript").embedTranscript
    >("embed-transcript", payload);
    console.log(`  retrying ${title.slice(0, 50)} → run=${handle.id}`);
    // small delay to avoid bursting the embedding provider again
    await new Promise((r) => setTimeout(r, 8000));
  }
  console.log("done");
}
main();
