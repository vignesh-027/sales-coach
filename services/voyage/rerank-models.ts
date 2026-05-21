// Allow-list of Voyage rerank models exposed in the Manage Users picker.
//
// Same shape as services/anthropic/models.ts — admin tile renders from this,
// the settings API validates incoming model IDs against this list.
//
// Pricing is list price (Voyage AI). Verify before shipping.

export interface RerankOption {
  id: string;
  label: string;
  description: string;
  tier: "paid";
  cost_per_mtok: number;
}

export const RERANK_OPTIONS: readonly RerankOption[] = [
  {
    id: "rerank-2.5-lite",
    label: "Rerank 2.5 Lite",
    description:
      "Default. Fast + cheap. Re-orders the top-50 retrieval candidates before Claude sees them.",
    tier: "paid",
    cost_per_mtok: 0.02,
  },
  {
    id: "rerank-2.5",
    label: "Rerank 2.5",
    description:
      "Higher precision on hard / ambiguous queries. ~2.5× the cost of Lite. Use when retrieval feels off.",
    tier: "paid",
    cost_per_mtok: 0.05,
  },
] as const;

export const DEFAULT_RERANK_MODEL = "rerank-2.5-lite";

export function isAllowedRerankModel(model: string): boolean {
  return RERANK_OPTIONS.some((o) => o.id === model);
}

export function findRerankOption(model: string): RerankOption | undefined {
  return RERANK_OPTIONS.find((o) => o.id === model);
}
