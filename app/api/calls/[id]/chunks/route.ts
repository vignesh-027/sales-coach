import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/client-admin";
import { getCurrentAppUser } from "@/app/_components/current-user";

export const runtime = "nodejs";

interface StatsRow {
  chunks_total: number;
  chunks_with_embedding: number;
  embedding_dims: number;
  min_norm: number;
  max_norm: number;
  avg_norm: number;
  duplicate_indexes: number;
}

function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as number[];
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  // Admin-only — this is a validation surface, not user-facing data.
  const me = await getCurrentAppUser();
  if (!me.is_admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const s = supabaseAdmin();

  const { data: statsData, error: sErr } = await s.rpc(
    "call_embedding_stats",
    { call_id_in: id },
  );
  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }
  const stats = (statsData as StatsRow[])[0] ?? null;

  const { data: sample, error: smErr } = await s
    .from("call_chunks")
    .select("chunk_index, chunk_text, embedding")
    .eq("call_id", id)
    .order("chunk_index", { ascending: true })
    .limit(1);
  if (smErr) {
    return NextResponse.json({ error: smErr.message }, { status: 500 });
  }
  const row = (sample ?? [])[0] as
    | { chunk_index: number; chunk_text: string; embedding: unknown }
    | undefined;
  let sampleOut: {
    chunk_index: number;
    chunk_text_preview: string;
    embedding_head: number[];
    embedding_tail: number[];
    embedding_length: number;
  } | null = null;
  if (row) {
    const vec = parseVector(row.embedding) ?? [];
    sampleOut = {
      chunk_index: row.chunk_index,
      chunk_text_preview: (row.chunk_text ?? "").slice(0, 200),
      embedding_head: vec.slice(0, 5),
      embedding_tail: vec.slice(-5),
      embedding_length: vec.length,
    };
  }

  return NextResponse.json({ stats, sample: sampleOut });
}
