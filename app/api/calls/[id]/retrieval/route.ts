import { NextResponse } from "next/server";
import { supabaseServer } from "@/services/supabase/server";
import { getUserByAuthId } from "@/services/supabase/queries/users";
import {
  getLatestCallAnalysisInput,
  firstAnalysisCreatedAt,
} from "@/services/supabase/queries/call-analysis-inputs";
import { getCall } from "@/services/supabase/queries/calls";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const me = await getUserByAuthId(data.user.id);
  if (!me) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const row = await getLatestCallAnalysisInput(id);
  if (row) {
    return NextResponse.json({ historical: false, row });
  }

  // No snapshot — check if this call predates observability or just hasn't
  // been re-analyzed since the migration.
  const call = await getCall(id);
  if (!call) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const firstSnap = await firstAnalysisCreatedAt();
  const historical = !firstSnap || call.created_at < firstSnap;
  return NextResponse.json({
    historical,
    row: null,
    note: historical
      ? "Historical run — detailed metrics not captured. Re-analyze the call to populate."
      : "No snapshot yet (call not analyzed since observability shipped).",
  });
}
