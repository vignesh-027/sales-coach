// AssemblyAI usage logger — writes one row to model_usage per completed
// transcription. Mirrors the best-effort pattern in services/voyage/embed.ts
// and rerank.ts: callers fire-and-forget via `void`, errors are swallowed
// with a warn.

import { recordModelUsage } from "@/services/supabase/queries/model-usage";
import { costForTranscription } from "./pricing";

export const DEFAULT_TRANSCRIPTION_MODEL = "universal-2";

export interface AssemblyAiUsageInput {
  model?: string;
  durationSec: number;
  scope: "transcribe_call" | "transcribe_knowledge";
  scopeId: string;
}

export async function recordAssemblyAiUsage(
  input: AssemblyAiUsageInput,
): Promise<void> {
  if (!input.durationSec || input.durationSec <= 0) return;
  const model = input.model ?? DEFAULT_TRANSCRIPTION_MODEL;
  await recordModelUsage({
    provider: "assemblyai",
    kind: "transcribe",
    model,
    duration_sec: input.durationSec,
    cost_usd: costForTranscription(model, input.durationSec),
    scope: input.scope,
    scope_id: input.scopeId,
  });
}
