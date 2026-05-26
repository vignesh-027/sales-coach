// Voyage's free-tier policy: 200M tokens per model per calendar month, for
// the models below. Used by /observability to badge each model as inside or
// over its free allowance for the selected month.

export const VOYAGE_FREE_TIER_TOKENS_PER_MODEL = 200_000_000;

export const VOYAGE_FREE_TIER_MODELS: readonly string[] = [
  "voyage-4",
  "voyage-4-lite",
  "voyage-4-large",
  "rerank-2.5",
  "rerank-2.5-lite",
];

export function isVoyageFreeTierModel(model: string): boolean {
  return VOYAGE_FREE_TIER_MODELS.includes(model);
}

export interface FreeTierStatus {
  model: string;
  tokens: number;
  limit: number;
  exceeded: boolean;
  pct: number;
}

export function freeTierStatus(model: string, tokens: number): FreeTierStatus {
  const limit = VOYAGE_FREE_TIER_TOKENS_PER_MODEL;
  return {
    model,
    tokens,
    limit,
    exceeded: tokens >= limit,
    pct: Math.min(100, (tokens / limit) * 100),
  };
}
