/**
 * Retry analyze for a failed call. Use after embedding is already done.
 * Usage: npx tsx --env-file=.env.local scripts/retry-call-analyze.ts <callId>
 */
import { supabaseAdmin } from "../services/supabase/client-admin";
import { tasks } from "../worker/client";
import type { AnalyzeCallPayload } from "../worker/analyze-call";
import { getCallChunkStats } from "../services/supabase/queries/call-chunks";

async function main() {
  const callId = process.argv[2];
  if (!callId) {
    console.error("Usage: retry-call-analyze.ts <callId>");
    process.exit(1);
  }
  const s = supabaseAdmin();
  const stats = await getCallChunkStats(callId);
  console.log(`> chunks for call: ${stats?.chunks_total ?? 0}`);

  await s
    .from("calls")
    .update({ process_status: "analyzing", process_error: null })
    .eq("id", callId);

  const payload: AnalyzeCallPayload = { callId };
  const handle = await tasks.trigger<
    typeof import("../worker/analyze-call").analyzeCall
  >("analyze-call", payload);
  console.log(`> triggered analyze-call run=${handle.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
