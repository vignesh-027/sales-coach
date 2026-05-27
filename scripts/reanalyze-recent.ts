/**
 * Re-run analyze-call for the N most-recent done calls.
 * Use after prompt/schema changes that should be back-applied to existing
 * reports (e.g. PROMPT_VERSION bump).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/reanalyze-recent.ts            # 20 most recent
 *   npx tsx --env-file=.env.local scripts/reanalyze-recent.ts --count 50
 *   npx tsx --env-file=.env.local scripts/reanalyze-recent.ts --spacing-sec 45
 *
 * Spacing: Anthropic's per-org 30k input-tokens-per-minute limit will reject
 * bursts. Each analyze-call uses ~6–12k input tokens, so we stagger triggers
 * with Trigger.dev's `delay` option (default 30s apart = ~2/min, safely under
 * the 30k limit even with retries).
 */
import { supabaseAdmin } from "../services/supabase/client-admin";
import { tasks } from "../worker/client";
import type { AnalyzeCallPayload } from "../worker/analyze-call";

function parseNumFlag(name: string, def: number): number {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const n = Number(process.argv[idx + 1]);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${name} must be a positive number`);
    process.exit(1);
  }
  return n;
}

async function main() {
  const count = Math.floor(parseNumFlag("--count", 20));
  const spacingSec = parseNumFlag("--spacing-sec", 30);
  const s = supabaseAdmin();

  const { data, error } = await s
    .from("calls")
    .select("id, created_at, process_status")
    .eq("process_status", "done")
    .order("created_at", { ascending: false })
    .limit(count);

  if (error) {
    console.error(error);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log("No done calls found.");
    return;
  }

  console.log(
    `> re-analyzing ${data.length} call(s), spacing ${spacingSec}s apart`,
  );
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    await s
      .from("calls")
      .update({ process_status: "analyzing", process_error: null })
      .eq("id", row.id);
    const payload: AnalyzeCallPayload = { callId: row.id };
    const delayMs = i * spacingSec * 1000;
    const handle = await tasks.trigger<
      typeof import("../worker/analyze-call").analyzeCall
    >(
      "analyze-call",
      payload,
      delayMs > 0
        ? { delay: new Date(Date.now() + delayMs) }
        : undefined,
    );
    console.log(
      `  · ${row.id} → run=${handle.id} (delay=${Math.round(delayMs / 1000)}s)`,
    );
  }
  console.log("> done queuing");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
