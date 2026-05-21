import { NextResponse } from "next/server";
import { getKnowledgeItem } from "@/services/supabase/queries/knowledge-items";
import { signedGetUrl } from "@/services/r2/signed-url";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const item = await getKnowledgeItem(id);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = await signedGetUrl(item.media_r2_key, 60 * 60);
  return NextResponse.json({
    url,
    media_type: item.media_type,
    source_format: item.source_format,
  });
}
