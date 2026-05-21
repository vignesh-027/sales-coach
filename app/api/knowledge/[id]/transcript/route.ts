import { NextResponse } from "next/server";
import { getTranscript } from "@/services/supabase/queries/transcripts";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const t = await getTranscript(id);
  if (!t) return NextResponse.json({ transcript: null });
  return NextResponse.json({
    transcript: { full_text: t.full_text, segments: t.segments },
  });
}
