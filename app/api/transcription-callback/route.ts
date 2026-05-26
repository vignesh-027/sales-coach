import { NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/services/assemblyai/verify-webhook";
import { verifyRunPodWebhook } from "@/services/runpod/verify-webhook";
import { finalizeKnowledgeTranscription } from "@/services/transcription/finalize";
import {
  getKnowledgeItemByTranscriptId,
  getKnowledgeItemByRunPodJobId,
} from "@/services/supabase/queries/knowledge-items";

export const runtime = "nodejs";

interface AaiWebhookBody {
  transcript_id: string;
  status: "completed" | "error";
}

interface RunPodWebhookBody {
  id: string;
  status: string;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") ?? "assemblyai";
  const cloned = req.clone();

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (provider === "assemblyai") {
    const body = rawBody as AaiWebhookBody;
    if (!body.transcript_id) {
      return NextResponse.json({ error: "no transcript_id" }, { status: 400 });
    }
    const item = await getKnowledgeItemByTranscriptId(body.transcript_id);
    if (!item) {
      return NextResponse.json(
        { error: "unknown transcript_id" },
        { status: 404 },
      );
    }
    if (!verifyWebhookSecret(cloned, item.webhook_secret)) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
    const outcome = await finalizeKnowledgeTranscription({
      itemOrId: item,
      provider: "assemblyai",
      providerId: body.transcript_id,
    });
    return NextResponse.json({ ok: true, outcome });
  }

  if (provider === "runpod") {
    if (!verifyRunPodWebhook(req)) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
    const body = rawBody as RunPodWebhookBody;
    if (!body.id) {
      return NextResponse.json({ error: "no job id" }, { status: 400 });
    }
    const item = await getKnowledgeItemByRunPodJobId(body.id);
    if (!item) {
      return NextResponse.json({ error: "unknown job id" }, { status: 404 });
    }
    const outcome = await finalizeKnowledgeTranscription({
      itemOrId: item,
      provider: "runpod",
      providerId: body.id,
    });
    return NextResponse.json({ ok: true, outcome });
  }

  return NextResponse.json(
    { error: `unknown provider "${provider}"` },
    { status: 400 },
  );
}
