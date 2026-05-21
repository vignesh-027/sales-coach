import { NextResponse } from "next/server";
import { randomBytes, randomUUID } from "crypto";
import {
  createKnowledgeItem,
  listKnowledgeItems,
  type KnowledgeKind,
} from "@/services/supabase/queries/knowledge-items";
import { signedPutUrl } from "@/services/r2/signed-url";
import {
  extFromFilename,
  validateUpload,
} from "@/services/upload/allowed-formats";

export const runtime = "nodejs";

interface CreateBody {
  kind: KnowledgeKind;
  title: string;
  description?: string;
  filename: string;
  contentType: string;
}

export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.kind || !body.title || !body.filename || !body.contentType) {
    return NextResponse.json(
      { error: "kind, title, filename, contentType required" },
      { status: 400 },
    );
  }
  if (
    body.kind !== "founder_video" &&
    body.kind !== "reference_call" &&
    body.kind !== "text_document"
  ) {
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  }

  const ext = extFromFilename(body.filename) || "bin";
  const v = validateUpload(body.filename, body.contentType);
  if (!v.ok || !v.format) {
    return NextResponse.json(
      { error: v.reason ?? `unsupported file: ${body.filename}` },
      { status: 400 },
    );
  }
  const format = v.format;
  if (body.kind === "text_document" && format !== "text") {
    return NextResponse.json(
      { error: "text_document kind requires a .txt or .md file" },
      { status: 400 },
    );
  }
  if (body.kind !== "text_document" && format === "text") {
    return NextResponse.json(
      { error: "audio/video kind cannot accept a text file" },
      { status: 400 },
    );
  }

  const r2Key = `knowledge/${body.kind}/${randomUUID()}.${ext}`;
  const webhookSecret = randomBytes(24).toString("hex");

  const item = await createKnowledgeItem({
    kind: body.kind,
    title: body.title,
    description: body.description,
    media_r2_key: r2Key,
    media_type: ext,
    source_format: format,
    webhook_secret: webhookSecret,
  });

  const uploadUrl = await signedPutUrl(r2Key, body.contentType, 60 * 30);

  return NextResponse.json({
    id: item.id,
    uploadUrl,
    r2Key,
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const kind =
    kindParam === "founder_video" ||
    kindParam === "reference_call" ||
    kindParam === "text_document"
      ? kindParam
      : undefined;
  const items = await listKnowledgeItems(kind);
  return NextResponse.json({ items });
}
