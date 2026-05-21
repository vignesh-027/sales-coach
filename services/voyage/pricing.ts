// Voyage AI list prices. Edited when Voyage publishes new pricing — older
// captured rows keep the cost they were inserted with, so this file affects
// only future calls.

export const VOYAGE_EMBED_PRICE_PER_MTOK: Record<string, number> = {
  "voyage-4-large": 0.18,
  "voyage-3-large": 0.18,
  "voyage-multilingual-2": 0.12,
};

export const VOYAGE_RERANK_PRICE_PER_MTOK: Record<string, number> = {
  "rerank-2.5-lite": 0.02,
  "rerank-2.5": 0.05,
  "rerank-2": 0.05,
};

export function costForEmbed(model: string, tokens: number): number {
  const rate = VOYAGE_EMBED_PRICE_PER_MTOK[model] ?? 0;
  return (rate * tokens) / 1_000_000;
}

export function costForRerank(model: string, tokens: number): number {
  const rate = VOYAGE_RERANK_PRICE_PER_MTOK[model] ?? 0;
  return (rate * tokens) / 1_000_000;
}
