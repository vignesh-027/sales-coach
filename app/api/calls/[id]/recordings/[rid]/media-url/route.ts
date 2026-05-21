import { NextResponse } from "next/server";
import { getRecording } from "@/services/supabase/queries/call-recordings";
import { signedGetUrl } from "@/services/r2/signed-url";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await ctx.params;
  const rec = await getRecording(rid);
  if (!rec || rec.call_id !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const url = await signedGetUrl(rec.media_r2_key, 60 * 60);
  return NextResponse.json({
    url,
    media_type: rec.media_type,
    source_format: rec.source_format,
  });
}
