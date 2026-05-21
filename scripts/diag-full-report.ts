import { supabaseAdmin } from "../services/supabase/client-admin";

const callId = process.argv[2];
(async () => {
  const s = supabaseAdmin();
  const { data } = await s
    .from("call_reports")
    .select("model, input_tokens, output_tokens, report")
    .eq("call_id", callId)
    .single();
  console.log(JSON.stringify(data, null, 2));
})();
