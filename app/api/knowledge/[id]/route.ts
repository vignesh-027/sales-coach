import { NextResponse } from "next/server";
import { tasks } from "@/worker/client";
import {
  getKnowledgeItem,
  deleteKnowledgeItem,
  updateKnowledgeStatus,
} from "@/services/supabase/queries/knowledge-items";
import { getTranscript } from "@/services/supabase/queries/transcripts";
import { deleteR2Object } from "@/services/r2/delete-object";
import type { IngestKnowledgePayload } from "@/worker/ingest-knowledge";
import type { IngestTextPayload } from "@/worker/ingest-text";
import type { EmbedTranscriptPayload } from "@/worker/embed-transcript";

export const runtime = "nodejs";

function webhookBase(req: Request): string {
  const explicit = process.env.Vercel_Public_Base_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const item = await getKnowledgeItem(id);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: { action?: string };
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    body = {};
  }
  if (body.action !== "start") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }

  const item = await getKnowledgeItem(id);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (
    item.process_status !== "queued" &&
    item.process_status !== "failed" &&
    item.process_status !== "embedding"
  ) {
    return NextResponse.json(
      { error: `cannot start in status ${item.process_status}` },
      { status: 409 },
    );
  }

  // Smart retry: if we already have a transcript (text or media), skip
  // transcription and re-run embedding only.
  const existingTranscript = await getTranscript(id);
  if (existingTranscript) {
    await updateKnowledgeStatus(id, {
      process_status: "embedding",
      process_error: null,
    });
    const payload: EmbedTranscriptPayload = { knowledgeItemId: id };
    const handle = await tasks.trigger<
      typeof import("@/worker/embed-transcript").embedTranscript
    >("embed-transcript", payload);
    return NextResponse.json({ ok: true, runId: handle.id, resumed: "embed" });
  }

  // Clear any stale error before re-attempting.
  if (item.process_error) {
    await updateKnowledgeStatus(id, { process_error: null });
  }

  if (item.source_format === "text") {
    const payload: IngestTextPayload = { knowledgeItemId: id };
    const handle = await tasks.trigger<
      typeof import("@/worker/ingest-text").ingestText
    >("ingest-text", payload);
    return NextResponse.json({ ok: true, runId: handle.id, resumed: "ingest-text" });
  }

  const payload: IngestKnowledgePayload = {
    knowledgeItemId: id,
    webhookBaseUrl: webhookBase(req),
  };
  const handle = await tasks.trigger<
    typeof import("@/worker/ingest-knowledge").ingestKnowledge
  >("ingest-knowledge", payload);

  return NextResponse.json({ ok: true, runId: handle.id, resumed: "ingest-media" });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const item = await getKnowledgeItem(id);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  // R2 best-effort: don't block delete if the object is already gone.
  try {
    await deleteR2Object(item.media_r2_key);
  } catch (err) {
    console.warn(
      `R2 delete failed for ${item.media_r2_key}:`,
      err instanceof Error ? err.message : err,
    );
  }
  // Cascade removes transcripts + knowledge_chunks via ON DELETE CASCADE.
  await deleteKnowledgeItem(id);
  return NextResponse.json({ ok: true });
}
