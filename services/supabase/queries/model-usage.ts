// Unified usage ledger — one row per model invocation across Voyage, Claude,
// AssemblyAI. See migrations/0014-model-usage.sql for the table shape and
// /observability for the consumer.

import { supabaseAdmin } from "../client-admin";

export type UsageProvider = "voyage" | "anthropic" | "assemblyai" | "runpod";
export type UsageKind = "embed" | "rerank" | "llm" | "transcribe";
export type UsageScope =
  | "analyze_call"
  | "ingest_call"
  | "ingest_knowledge"
  | "knowledge_search"
  | "transcribe_call"
  | "transcribe_knowledge";

export interface ModelUsageInsert {
  provider: UsageProvider;
  kind: UsageKind;
  model: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  tokens?: number | null;
  duration_sec?: number | null;
  cost_usd: number;
  scope?: UsageScope | string | null;
  scope_id?: string | null;
}

// Best-effort: never let observability writes break the hot path.
export async function recordModelUsage(row: ModelUsageInsert): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("model_usage").insert({
      provider: row.provider,
      kind: row.kind,
      model: row.model,
      input_tokens: row.input_tokens ?? null,
      output_tokens: row.output_tokens ?? null,
      tokens: row.tokens ?? null,
      duration_sec: row.duration_sec ?? null,
      cost_usd: row.cost_usd,
      scope: row.scope ?? null,
      scope_id: row.scope_id ?? null,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[model-usage] insert failed:", error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[model-usage] insert threw:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries for /observability — calendar-month scoped.
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthlyUsageRow {
  provider: UsageProvider;
  kind: UsageKind;
  model: string;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
  duration_sec: number;
  cost_usd: number;
}

// Returns half-open [from, to) ISO bounds for the given calendar month (UTC).
export function monthBoundsUtc(year: number, month: number): {
  from: string;
  to: string;
} {
  // month is 1-12 (human). Date.UTC is 0-11.
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const to = new Date(Date.UTC(year, month, 1)).toISOString();
  return { from, to };
}

export async function monthlyUsageByModel(args: {
  year: number;
  month: number;
}): Promise<MonthlyUsageRow[]> {
  const { from, to } = monthBoundsUtc(args.year, args.month);
  const { data, error } = await supabaseAdmin()
    .from("model_usage")
    .select(
      "provider, kind, model, input_tokens, output_tokens, tokens, duration_sec, cost_usd",
    )
    .gte("created_at", from)
    .lt("created_at", to);
  if (error) throw error;

  type Row = {
    provider: UsageProvider;
    kind: UsageKind;
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    tokens: number | null;
    duration_sec: number | null;
    cost_usd: number | string;
  };
  const buckets = new Map<string, MonthlyUsageRow>();
  for (const r of (data ?? []) as Row[]) {
    const key = `${r.provider}::${r.kind}::${r.model}`;
    const cur = buckets.get(key) ?? {
      provider: r.provider,
      kind: r.kind,
      model: r.model,
      input_tokens: 0,
      output_tokens: 0,
      tokens: 0,
      duration_sec: 0,
      cost_usd: 0,
    };
    cur.input_tokens += r.input_tokens ?? 0;
    cur.output_tokens += r.output_tokens ?? 0;
    cur.tokens += r.tokens ?? 0;
    cur.duration_sec += r.duration_sec ?? 0;
    cur.cost_usd += Number(r.cost_usd) || 0;
    buckets.set(key, cur);
  }
  return Array.from(buckets.values()).sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return b.tokens + b.duration_sec - (a.tokens + a.duration_sec);
  });
}

export interface ScopedUsageModel {
  provider: UsageProvider;
  kind: UsageKind;
  model: string;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
  duration_sec: number;
  cost_usd: number;
}

export interface ScopedUsageGroup {
  scope: string;
  scope_id: string;
  last_activity: string;
  total_cost_usd: number;
  models: ScopedUsageModel[];
}

// Per-(scope, scope_id) breakdown for the month. Powers "Recent analysis" —
// one entry per call / knowledge item, with the full list of models it touched.
export async function recentScopedUsage(args: {
  year: number;
  month: number;
  limit?: number;
}): Promise<ScopedUsageGroup[]> {
  const { from, to } = monthBoundsUtc(args.year, args.month);
  const limit = args.limit ?? 100;
  const { data, error } = await supabaseAdmin()
    .from("model_usage")
    .select(
      "created_at, provider, kind, model, input_tokens, output_tokens, tokens, duration_sec, cost_usd, scope, scope_id",
    )
    .gte("created_at", from)
    .lt("created_at", to)
    .not("scope_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;

  type Row = {
    created_at: string;
    provider: UsageProvider;
    kind: UsageKind;
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    tokens: number | null;
    duration_sec: number | null;
    cost_usd: number | string;
    scope: string | null;
    scope_id: string | null;
  };

  const groups = new Map<string, ScopedUsageGroup>();
  // We bucket by scope_id (NOT scope+scope_id) so a single call shows one row
  // even though embed and rerank and llm all carry scope='analyze_call' while
  // transcribe carries scope='transcribe_call'.
  const modelBuckets = new Map<string, Map<string, ScopedUsageModel>>();

  for (const r of (data ?? []) as Row[]) {
    if (!r.scope_id) continue;
    // Normalize transcribe_call → analyze_call grouping: roll up to whichever
    // scope is "primary" for that scope_id. Simplest: group all rows for the
    // same scope_id together regardless of scope, but display the most-recent
    // scope as the row label.
    const groupKey = r.scope_id;
    let g = groups.get(groupKey);
    if (!g) {
      g = {
        scope: r.scope ?? "",
        scope_id: r.scope_id,
        last_activity: r.created_at,
        total_cost_usd: 0,
        models: [],
      };
      groups.set(groupKey, g);
      modelBuckets.set(groupKey, new Map());
    }
    if (r.created_at > g.last_activity) {
      g.last_activity = r.created_at;
      g.scope = r.scope ?? g.scope;
    }
    g.total_cost_usd += Number(r.cost_usd) || 0;

    const mb = modelBuckets.get(groupKey)!;
    const mkey = `${r.provider}::${r.kind}::${r.model}`;
    const m = mb.get(mkey) ?? {
      provider: r.provider,
      kind: r.kind,
      model: r.model,
      input_tokens: 0,
      output_tokens: 0,
      tokens: 0,
      duration_sec: 0,
      cost_usd: 0,
    };
    m.input_tokens += r.input_tokens ?? 0;
    m.output_tokens += r.output_tokens ?? 0;
    m.tokens += r.tokens ?? 0;
    m.duration_sec += r.duration_sec ?? 0;
    m.cost_usd += Number(r.cost_usd) || 0;
    mb.set(mkey, m);
  }

  for (const [gid, mb] of modelBuckets) {
    const g = groups.get(gid)!;
    g.models = Array.from(mb.values()).sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.kind.localeCompare(b.kind);
    });
  }

  return Array.from(groups.values())
    .sort((a, b) => (a.last_activity < b.last_activity ? 1 : -1))
    .slice(0, limit);
}
