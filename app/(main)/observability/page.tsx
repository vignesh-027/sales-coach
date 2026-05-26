import { getCurrentAppUser } from "@/app/_components/current-user";
import {
  monthlyUsageByModel,
  recentScopedUsage,
  type MonthlyUsageRow,
  type ScopedUsageGroup,
} from "@/services/supabase/queries/model-usage";
import { getAppSettings } from "@/services/supabase/queries/app-settings";
import { supabaseAdmin } from "@/services/supabase/client-admin";
import { VOYAGE_EMBEDDING_MODEL } from "@/services/voyage/client";
import { DEFAULT_TRANSCRIPTION_MODEL } from "@/services/assemblyai/usage";
import { ObservabilityClient } from "./observability-client";

// Read-only — Voyage + Claude + AssemblyAI rollups by calendar month, plus a
// per-call / per-knowledge breakdown for the same month. Open to all signed-in
// users; getCurrentAppUser handles the auth gate.
export default async function ObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  await getCurrentAppUser();

  const sp = await searchParams;
  const now = new Date();
  const yearNum = Number(sp.year);
  const monthNum = Number(sp.month);
  const year =
    Number.isInteger(yearNum) && yearNum >= 2020 && yearNum <= 2100
      ? yearNum
      : now.getUTCFullYear();
  const month =
    Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12
      ? monthNum
      : now.getUTCMonth() + 1;

  const [usage, recent, settings] = await Promise.all([
    monthlyUsageByModel({ year, month }),
    recentScopedUsage({ year, month, limit: 50 }),
    getAppSettings(),
  ]);

  // Hydrate titles for recent rows. Two cheap lookups against the ID lists.
  const callIds = new Set<string>();
  const knowledgeIds = new Set<string>();
  for (const g of recent) {
    if (g.scope.startsWith("transcribe_knowledge") || g.scope === "ingest_knowledge") {
      knowledgeIds.add(g.scope_id);
    } else {
      callIds.add(g.scope_id);
    }
  }
  // Some scope_ids may belong to either set depending on which scope was
  // observed last — query both tables and resolve per-row below.
  const sb = supabaseAdmin();
  const [callsRes, knowledgeRes] = await Promise.all([
    callIds.size > 0
      ? sb.from("calls").select("id, title, client_name").in("id", Array.from(callIds))
      : Promise.resolve({ data: [], error: null }),
    knowledgeIds.size > 0
      ? sb.from("knowledge_items").select("id, title, kind").in("id", Array.from(knowledgeIds))
      : Promise.resolve({ data: [], error: null }),
  ]);
  const callTitle = new Map<string, string>();
  for (const c of (callsRes.data ?? []) as Array<{
    id: string;
    title: string;
    client_name: string;
  }>) {
    callTitle.set(c.id, c.title || c.client_name || c.id.slice(0, 8));
  }
  const knowledgeTitle = new Map<string, string>();
  for (const k of (knowledgeRes.data ?? []) as Array<{
    id: string;
    title: string;
    kind: string;
  }>) {
    knowledgeTitle.set(k.id, k.title || k.id.slice(0, 8));
  }

  const recentResolved = recent.map((g) => {
    const isKnowledge =
      knowledgeTitle.has(g.scope_id) || g.scope.endsWith("_knowledge");
    return {
      scope: g.scope,
      scope_id: g.scope_id,
      kind: isKnowledge ? ("knowledge" as const) : ("call" as const),
      title:
        (isKnowledge ? knowledgeTitle.get(g.scope_id) : callTitle.get(g.scope_id)) ??
        g.scope_id.slice(0, 8),
      last_activity: g.last_activity,
      total_cost_usd: g.total_cost_usd,
      models: g.models,
    };
  });

  return (
    <ObservabilityClient
      year={year}
      month={month}
      currentYear={now.getUTCFullYear()}
      currentMonth={now.getUTCMonth() + 1}
      usage={usage}
      recent={recentResolved}
      selectedModels={{
        llm: settings.llm_model,
        rerank: settings.rerank_model,
        embed: VOYAGE_EMBEDDING_MODEL,
        transcribe: DEFAULT_TRANSCRIPTION_MODEL,
      }}
    />
  );
}

export type ObservabilityRecentRow = {
  scope: string;
  scope_id: string;
  kind: "call" | "knowledge";
  title: string;
  last_activity: string;
  total_cost_usd: number;
  models: ScopedUsageGroup["models"];
};

export type ObservabilityUsageRow = MonthlyUsageRow;
