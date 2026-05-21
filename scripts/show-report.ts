import { supabaseAdmin } from "../services/supabase/client-admin";

const id = process.argv[2];
if (!id) process.exit(1);

(async () => {
  const s = supabaseAdmin();
  const { data } = await s
    .from("call_reports")
    .select("model, prompt_version, input_tokens, output_tokens, report")
    .eq("call_id", id)
    .single();
  if (!data) {
    console.log("(no report)");
    return;
  }
  const r = data.report as {
    summary?: {
      tldr?: string;
      outcome?: string;
      deal_health?: string;
      rep_performance_rubric?: Record<string, number>;
    };
    key_moments?: unknown[];
    rewrites?: unknown[];
    patterns?: unknown[];
  };
  console.log("model:", data.model);
  console.log("prompt_version:", data.prompt_version);
  console.log("tokens:", data.input_tokens, "→", data.output_tokens);
  console.log("tldr:", r.summary?.tldr?.slice(0, 200));
  console.log("outcome:", r.summary?.outcome, "· health:", r.summary?.deal_health);
  console.log("rubric:", r.summary?.rep_performance_rubric);
  console.log("key_moments:", r.key_moments?.length ?? 0);
  console.log("rewrites:", r.rewrites?.length ?? 0);
  console.log("patterns:", r.patterns?.length ?? 0);
})();
