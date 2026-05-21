import { supabaseAdmin } from "../services/supabase/client-admin";

const callId = process.argv[2];

(async () => {
  const s = supabaseAdmin();
  const { data } = await s
    .from("call_reports")
    .select("call_id, model, prompt_version, input_tokens, output_tokens, created_at, updated_at")
    .in("call_id", [callId, "35831243-f265-469c-a888-9542d6216c4e"]);
  console.log(JSON.stringify(data, null, 2));

  // List recent analyze-call runs by call_analysis_inputs.created_at
  const { data: runs } = await s
    .from("call_analysis_inputs")
    .select("call_id, created_at, vector_hits, fts_hits, rerank_kept")
    .order("created_at", { ascending: false })
    .limit(10);
  console.log("\nRECENT ANALYSIS INPUTS:");
  console.log(JSON.stringify(runs, null, 2));
})();
