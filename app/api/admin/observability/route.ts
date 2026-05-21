import { NextResponse } from "next/server";
import { supabaseServer } from "@/services/supabase/server";
import { getUserByAuthId } from "@/services/supabase/queries/users";
import { voyageUsageLastNDays } from "@/services/supabase/queries/voyage-usage";
import {
  analysisAveragesLastNDays,
  recentAnalyses,
} from "@/services/supabase/queries/call-analysis-inputs";

export const runtime = "nodejs";

// Observability rollups are read-only and open to any signed-in app user.
// No admin gate — the gate is just "is this a real user we know about?".
async function requireSignedInAppUser() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const me = await getUserByAuthId(data.user.id);
  return me ?? null;
}

export async function GET() {
  if (!(await requireSignedInAppUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [usage, averages, recent] = await Promise.all([
    voyageUsageLastNDays(30),
    analysisAveragesLastNDays(30),
    recentAnalyses(20),
  ]);
  return NextResponse.json({ usage, averages, recent });
}
