import { NextResponse } from "next/server";
import { tasks } from "@/worker/client";
import {
  getCall,
  deleteCall,
  updateCallStatus,
} from "@/services/supabase/queries/calls";
import {
  listRecordings,
  updateRecording,
} from "@/services/supabase/queries/call-recordings";
import { listCallTranscriptsOrdered } from "@/services/supabase/queries/call-transcripts";
import { getCallReport } from "@/services/supabase/queries/call-reports";
import { getCallChunkStats } from "@/services/supabase/queries/call-chunks";
import { signedGetUrl } from "@/services/r2/signed-url";
import { deleteR2Object } from "@/services/r2/delete-object";
import type { IngestCallRecordingPayload } from "@/worker/ingest-call-recording";
import type { EmbedCallPayload } from "@/worker/embed-call";
import type { AnalyzeCallPayload } from "@/worker/analyze-call";

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
  const call = await getCall(id);
  if (!call) return NextResponse.json({ error: "not found" }, { status: 404 });

  const recordings = await listRecordings(id);
  const transcripts = await listCallTranscriptsOrdered(id);
  const transcriptByRec = new Map(
    transcripts.map((t) => [t.call_recording_id, t]),
  );
  const recordingsOut = await Promise.all(
    recordings.map(async (r) => {
      const t = transcriptByRec.get(r.id) ?? null;
      const mediaUrl = await signedGetUrl(r.media_r2_key, 60 * 60).catch(
        () => null,
      );
      return {
        id: r.id,
        recording_index: r.recording_index,
        media_type: r.media_type,
        source_format: r.source_format,
        duration_sec: r.duration_sec,
        transcribe_status: r.transcribe_status,
        transcribe_error: r.transcribe_error,
        media_url: mediaUrl,
        transcript: t
          ? { full_text: t.full_text, segments: t.segments }
          : null,
      };
    }),
  );

  const report = await getCallReport(id);

  return NextResponse.json({
    call,
    recordings: recordingsOut,
    report: report
      ? {
          model: report.model,
          prompt_version: report.prompt_version,
          report: report.report,
          input_tokens: report.input_tokens,
          output_tokens: report.output_tokens,
          created_at: report.created_at,
        }
      : null,
  });
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
  if (body.action !== "start" && body.action !== "reembed") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }

  const call = await getCall(id);
  if (!call) return NextResponse.json({ error: "not found" }, { status: 404 });

  const recordings = await listRecordings(id);
  if (recordings.length === 0) {
    return NextResponse.json({ error: "no recordings" }, { status: 400 });
  }

  // `reembed` forces the embed step regardless of current chunk_total / status.
  // Used by the admin "Rerun embedding" button when the chunk store is corrupt
  // (zero chunks despite status=done, wrong vector dims, duplicate chunk_index
  // rows). The regular `start` path skips embed when chunks exist, which is
  // wrong for this case — that's what this branch fixes.
  if (body.action === "reembed") {
    const transcripts = await listCallTranscriptsOrdered(id);
    if (transcripts.length !== recordings.length) {
      return NextResponse.json(
        { error: "transcripts incomplete; use action=start instead" },
        { status: 400 },
      );
    }
    await updateCallStatus(id, {
      process_status: "embedding",
      process_error: null,
    });
    const payload: EmbedCallPayload = { callId: id };
    const handle = await tasks.trigger<
      typeof import("@/worker/embed-call").embedCall
    >("embed-call", payload);
    return NextResponse.json({
      ok: true,
      runId: handle.id,
      resumed: "embed",
    });
  }

  await updateCallStatus(id, { process_error: null });

  // Resume from where the pipeline failed. Existing progress is preserved:
  // transcripts, embeddings, and reports are all upserts.
  const allDone = recordings.every((r) => r.transcribe_status === "done");
  if (allDone) {
    const transcripts = await listCallTranscriptsOrdered(id);
    if (transcripts.length === recordings.length) {
      // Embedding already done? Skip straight to analyze. Otherwise re-embed.
      const stats = await getCallChunkStats(id);
      if ((stats?.chunks_total ?? 0) > 0) {
        await updateCallStatus(id, { process_status: "analyzing" });
        const payload: AnalyzeCallPayload = { callId: id };
        const handle = await tasks.trigger<
          typeof import("@/worker/analyze-call").analyzeCall
        >("analyze-call", payload);
        return NextResponse.json({
          ok: true,
          runId: handle.id,
          resumed: "analyze",
        });
      }
      await updateCallStatus(id, { process_status: "embedding" });
      const payload: EmbedCallPayload = { callId: id };
      const handle = await tasks.trigger<
        typeof import("@/worker/embed-call").embedCall
      >("embed-call", payload);
      return NextResponse.json({
        ok: true,
        runId: handle.id,
        resumed: "embed",
      });
    }
  }

  // Re-trigger ingest for any recording not done.
  await updateCallStatus(id, { process_status: "transcribing" });
  const toIngest = recordings.filter((r) => r.transcribe_status !== "done");
  const runIds: string[] = [];
  for (const rec of toIngest) {
    await updateRecording(rec.id, {
      transcribe_status: "queued",
      transcribe_error: null,
    });
    const payload: IngestCallRecordingPayload = {
      callId: id,
      recordingId: rec.id,
      webhookBaseUrl: webhookBase(req),
    };
    const handle = await tasks.trigger<
      typeof import("@/worker/ingest-call-recording").ingestCallRecording
    >("ingest-call-recording", payload);
    runIds.push(handle.id);
  }

  return NextResponse.json({ ok: true, runIds, resumed: "ingest" });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const result = await deleteCall(id);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });

  for (const key of result.media_r2_keys) {
    try {
      await deleteR2Object(key);
    } catch (err) {
      console.warn(
        `R2 delete failed for ${key}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return NextResponse.json({ ok: true });
}
