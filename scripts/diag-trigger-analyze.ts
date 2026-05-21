import { tasks } from "../worker/client";
import type { AnalyzeCallPayload } from "../worker/analyze-call";

const callId = process.argv[2];
if (!callId) {
  console.error("usage: tsx scripts/diag-trigger-analyze.ts <callId>");
  process.exit(1);
}

(async () => {
  const handle = await tasks.trigger<
    typeof import("../worker/analyze-call").analyzeCall
  >("analyze-call", { callId } satisfies AnalyzeCallPayload);
  console.log("triggered runId:", handle.id);
})();
