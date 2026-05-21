import { NextResponse } from "next/server";
import { supabaseServer } from "@/services/supabase/server";
import { getUserByAuthId } from "@/services/supabase/queries/users";
import {
  getKnowledgeItemUsage,
  firstAnalysisCreatedAt,
} from "@/services/supabase/queries/call-analysis-inputs";
import { getKnowledgeItem } from "@/services/supabase/queries/knowledge-items";

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

  const usage = await getKnowledgeItemUsage(id);
  if (usage && usage.appearances > 0) {
    return NextResponse.json({ historical: false, usage });
  }

  const item = await getKnowledgeItem(id);
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const firstSnap = await firstAnalysisCreatedAt();
  const historical = !firstSnap || item.created_at < firstSnap;
  return NextResponse.json({
    historical,
    usage: usage ?? {
      knowledge_item_id: id,
      appearances: 0,
      kept_count: 0,
      dropped_count: 0,
      last_used_at: null,
    },
    note: historical
      ? "Historical item — detailed usage not captured before observability shipped. Re-analyze calls to populate."
      : "Not yet used in any analysis.",
  });
}
