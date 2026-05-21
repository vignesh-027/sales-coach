import { supabaseAdmin } from "../client-admin";

export interface VoyageUsageInsert {
  kind: "embed" | "rerank";
  model: string;
  tokens: number;
  cost_usd: number;
  scope?: string | null;
  scope_id?: string | null;
}

export async function recordVoyageUsage(row: VoyageUsageInsert): Promise<void> {
  // Best-effort: never let observability writes break the hot path.
  try {
    const { error } = await supabaseAdmin().from("voyage_usage").insert(row);
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[voyage-usage] insert failed:", error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[voyage-usage] insert threw:", e);
  }
}

export interface VoyageUsageWindow {
  embed_tokens: number;
  rerank_tokens: number;
  embed_cost_usd: number;
  rerank_cost_usd: number;
  by_model: Array<{
    kind: "embed" | "rerank";
    model: string;
    tokens: number;
    cost_usd: number;
  }>;
}

export async function voyageUsageLastNDays(
  days: number,
): Promise<VoyageUsageWindow> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("voyage_usage")
    .select("kind, model, tokens, cost_usd")
    .gte("created_at", since);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    kind: "embed" | "rerank";
    model: string;
    tokens: number;
    cost_usd: number | string;
  }>;
  const buckets = new Map<
    string,
    { kind: "embed" | "rerank"; model: string; tokens: number; cost_usd: number }
  >();
  let embedTok = 0,
    rerankTok = 0,
    embedCost = 0,
    rerankCost = 0;
  for (const r of rows) {
    const cost = Number(r.cost_usd) || 0;
    if (r.kind === "embed") {
      embedTok += r.tokens;
      embedCost += cost;
    } else {
      rerankTok += r.tokens;
      rerankCost += cost;
    }
    const key = `${r.kind}::${r.model}`;
    const cur = buckets.get(key);
    if (cur) {
      cur.tokens += r.tokens;
      cur.cost_usd += cost;
    } else {
      buckets.set(key, {
        kind: r.kind,
        model: r.model,
        tokens: r.tokens,
        cost_usd: cost,
      });
    }
  }
  return {
    embed_tokens: embedTok,
    rerank_tokens: rerankTok,
    embed_cost_usd: embedCost,
    rerank_cost_usd: rerankCost,
    by_model: Array.from(buckets.values()).sort(
      (a, b) => b.tokens - a.tokens,
    ),
  };
}

// Lifetime token counter — used to drive the free-tier progress bar on
// /admin/observability. Voyage's 200M free-tier is shared across embed +
// rerank for our usage; we surface both legs so the UI can label them.
export interface VoyageLifetimeTokens {
  embed: number;
  rerank: number;
  total: number;
}

export async function voyageLifetimeTokens(): Promise<VoyageLifetimeTokens> {
  const { data, error } = await supabaseAdmin()
    .from("voyage_usage")
    .select("kind, tokens");
  if (error) throw error;
  const rows = (data ?? []) as Array<{ kind: "embed" | "rerank"; tokens: number }>;
  let embed = 0,
    rerank = 0;
  for (const r of rows) {
    if (r.kind === "embed") embed += r.tokens;
    else rerank += r.tokens;
  }
  return { embed, rerank, total: embed + rerank };
}
