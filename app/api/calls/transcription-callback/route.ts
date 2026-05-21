import { NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/services/assemblyai/verify-webhook";
import { finalizeCallRecording } from "@/services/assemblyai/finalize";
import { getRecordingByTranscriptId } from "@/services/supabase/queries/call-recordings";

export const runtime = "nodejs";

interface AaiWebhookBody {
  transcript_id: string;
  status: "completed" | "error";
}

export async function POST(req: Request) {
  const cloned = req.clone();
  let body: AaiWebhookBody;
  try {
    body = (await req.json()) as AaiWebhookBody;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.transcript_id) {
    return NextResponse.json({ error: "no transcript_id" }, { status: 400 });
  }

  const rec = await getRecordingByTranscriptId(body.transcript_id);
  if (!rec) {
    return NextResponse.json({ error: "unknown transcript_id" }, { status: 404 });
  }

  if (!verifyWebhookSecret(cloned, rec.webhook_secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const outcome = await finalizeCallRecording(rec, body.transcript_id);
  return NextResponse.json({ ok: true, outcome });
}
