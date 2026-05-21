import { supabaseAdmin } from "../services/supabase/client-admin";

async function main() {
  const sb = supabaseAdmin();
  const { data: calls } = await sb
    .from("calls")
    .select("id, title, process_status, process_error, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  console.log("CALLS:", JSON.stringify(calls, null, 2));

  const { data: recs } = await sb
    .from("call_recordings")
    .select(
      "id, call_id, recording_index, transcribe_status, transcribe_error, assemblyai_transcript_id",
    )
    .order("created_at", { ascending: false })
    .limit(20);
  console.log("RECORDINGS:", JSON.stringify(recs, null, 2));
}
void main();
