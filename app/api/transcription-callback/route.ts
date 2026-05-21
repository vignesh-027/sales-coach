import { NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/services/assemblyai/verify-webhook";
import { finalizeKnowledgeItem } from "@/services/assemblyai/finalize";
import { getKnowledgeItemByTranscriptId } from "@/services/supabase/queries/knowledge-items";

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

  const item = await getKnowledgeItemByTranscriptId(body.transcript_id);
  if (!item) {
    return NextResponse.json({ error: "unknown transcript_id" }, { status: 404 });
  }

  if (!verifyWebhookSecret(cloned, item.webhook_secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const outcome = await finalizeKnowledgeItem(item, body.transcript_id);
  return NextResponse.json({ ok: true, outcome });
}
