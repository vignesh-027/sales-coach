// Allow-list of Claude LLM models exposed in the Manage Users picker.
//
// The admin dropdown shows these options; the settings API validates the
// incoming model ID against this list. We do NOT auto-discover from
// Anthropic's API — an allow-list keeps cost surprises off the table and
// makes the human-facing labels stable.
//
// Pricing figures are list price as of the migration date. Verify against
// https://www.anthropic.com/pricing before shipping.

export interface LlmOption {
  id: string;
  label: string;
  description: string;
  tier: "paid";
  cost_per_mtok_input: number;
  cost_per_mtok_output: number;
}

export const LLM_OPTIONS: readonly LlmOption[] = [
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    description:
      "Fast and cheap. Default. Good enough for most call analyses.",
    tier: "paid",
    cost_per_mtok_input: 1.0,
    cost_per_mtok_output: 5.0,
  },
  {
    id: "claude-sonnet-4-5-20250929",
    label: "Claude Sonnet 4.5",
    description:
      "Higher quality reasoning for nuanced state-installation analysis. Slower, ~5× the cost of Haiku.",
    tier: "paid",
    cost_per_mtok_input: 3.0,
    cost_per_mtok_output: 15.0,
  },
  {
    id: "claude-opus-4-7-latest",
    label: "Claude Opus 4.7",
    description:
      "Highest quality, deepest founder-voice fidelity. Slowest, ~5× the cost of Haiku. Use sparingly.",
    tier: "paid",
    cost_per_mtok_input: 5.0,
    cost_per_mtok_output: 25.0,
  },
] as const;

// Haiku 4.5 is unreliable for the 4-field save_call_report tool schema —
// it non-deterministically returns only the `summary` field (collapsing
// key_moments/rewrites/patterns to empty) or splits the report across
// parallel tool_use blocks. Sonnet 4.5 emits all 4 fields in one block
// reliably. Cost is ~5× Haiku but call analyses are infrequent, so this
// trade is correct for accuracy.
export const DEFAULT_LLM_MODEL = "claude-sonnet-4-5-20250929";

export function isAllowedLlmModel(model: string): boolean {
  return LLM_OPTIONS.some((o) => o.id === model);
}

export function findLlmOption(model: string): LlmOption | undefined {
  return LLM_OPTIONS.find((o) => o.id === model);
}

export function costForLlm(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const opt = findLlmOption(model);
  if (!opt) return 0;
  return (
    (opt.cost_per_mtok_input * inputTokens) / 1_000_000 +
    (opt.cost_per_mtok_output * outputTokens) / 1_000_000
  );
}
