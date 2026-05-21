import { NextResponse } from "next/server";
import { randomBytes, randomUUID } from "crypto";
import { createCall, listCalls, type CallType } from "@/services/supabase/queries/calls";
import { createRecording, listRecordings } from "@/services/supabase/queries/call-recordings";
import { signedPutUrl } from "@/services/r2/signed-url";
import { getUserById } from "@/services/supabase/queries/users";
import {
  extFromFilename,
  validateUpload,
} from "@/services/upload/allowed-formats";

export const runtime = "nodejs";

interface FileSpec {
  filename: string;
  contentType: string;
}

interface CreateBody {
  call_type: CallType;
  salesperson_name: string;
  client_name: string;
  salesperson_id?: string;
  client_id?: string;
  title?: string;
  files: FileSpec[];
}

function defaultTitle(clientName: string, callType: CallType): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${clientName} · ${callType.replace(/_/g, "-")} · ${date}`;
}

export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (
    body.call_type !== "pre_sale" &&
    body.call_type !== "sales_followup" &&
    body.call_type !== "sales_closing"
  ) {
    return NextResponse.json({ error: "bad call_type" }, { status: 400 });
  }
  if (!body.salesperson_name?.trim() || !body.client_name?.trim()) {
    return NextResponse.json(
      { error: "salesperson_name and client_name required" },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return NextResponse.json({ error: "at least one file required" }, { status: 400 });
  }

  for (const f of body.files) {
    const v = validateUpload(f.filename, f.contentType);
    if (!v.ok || v.format === "text") {
      return NextResponse.json(
        {
          error:
            v.reason ??
            (v.format === "text"
              ? `text files are not supported for calls (${f.filename})`
              : `unsupported file: ${f.filename}`),
        },
        { status: 400 },
      );
    }
  }

  // Canonicalize names from the user dictionary when ids are present.
  let canonicalSalesName = body.salesperson_name.trim();
  let canonicalClientName = body.client_name.trim();
  if (body.salesperson_id) {
    const u = await getUserById(body.salesperson_id);
    if (u) canonicalSalesName = u.name;
  }
  if (body.client_id) {
    const u = await getUserById(body.client_id);
    if (u) canonicalClientName = u.name;
  }

  const call = await createCall({
    call_type: body.call_type,
    title: body.title?.trim() || defaultTitle(canonicalClientName, body.call_type),
    salesperson_name: canonicalSalesName,
    client_name: canonicalClientName,
    salesperson_id: body.salesperson_id ?? null,
    client_id: body.client_id ?? null,
  });

  const recordings: Array<{ id: string; uploadUrl: string; r2Key: string }> = [];
  for (let i = 0; i < body.files.length; i++) {
    const f = body.files[i];
    const ext = extFromFilename(f.filename) || "bin";
    const v = validateUpload(f.filename, f.contentType);
    const format = (v.format ?? "audio") as "audio" | "video";
    const r2Key = `calls/${call.id}/${randomUUID()}.${ext}`;
    const webhookSecret = randomBytes(24).toString("hex");
    const rec = await createRecording({
      call_id: call.id,
      recording_index: i,
      media_r2_key: r2Key,
      media_type: ext,
      source_format: format,
      webhook_secret: webhookSecret,
    });
    const uploadUrl = await signedPutUrl(r2Key, f.contentType, 60 * 30);
    recordings.push({ id: rec.id, uploadUrl, r2Key });
  }

  return NextResponse.json({ callId: call.id, recordings });
}

export async function GET() {
  const calls = await listCalls();
  const withCounts = await Promise.all(
    calls.map(async (c) => {
      const recs = await listRecordings(c.id);
      const total = recs.reduce((acc, r) => acc + (r.duration_sec ?? 0), 0);
      return {
        ...c,
        recordings_count: recs.length,
        duration_sec_total: total,
      };
    }),
  );
  return NextResponse.json({ calls: withCounts });
}
