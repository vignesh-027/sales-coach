import { supabaseAdmin } from "../client-admin";

export type KnowledgeKind =
  | "founder_video"
  | "reference_call"
  | "text_document";
export type SourceFormat = "audio" | "video" | "text";
export type ProcessStatus =
  | "queued"
  | "transcribing"
  | "embedding"
  | "done"
  | "failed";

export interface KnowledgeItem {
  id: string;
  kind: KnowledgeKind;
  title: string;
  description: string | null;
  media_r2_key: string;
  media_type: string;
  source_format: SourceFormat | null;
  duration_sec: number | null;
  process_status: ProcessStatus;
  process_error: string | null;
  assemblyai_transcript_id: string | null;
  runpod_job_id: string | null;
  /** Full transcription model id, e.g. "assemblyai/universal-2". */
  transcription_provider: string | null;
  webhook_secret: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function createKnowledgeItem(input: {
  kind: KnowledgeKind;
  title: string;
  description?: string;
  media_r2_key: string;
  media_type: string;
  source_format: SourceFormat;
  webhook_secret: string;
  created_by?: string;
}): Promise<KnowledgeItem> {
  const { data, error } = await supabaseAdmin()
    .from("knowledge_items")
    .insert({
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      media_r2_key: input.media_r2_key,
      media_type: input.media_type,
      source_format: input.source_format,
      webhook_secret: input.webhook_secret,
      created_by: input.created_by ?? null,
      process_status: "queued",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as KnowledgeItem;
}

export async function getKnowledgeItem(id: string): Promise<KnowledgeItem | null> {
  const { data, error } = await supabaseAdmin()
    .from("knowledge_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as KnowledgeItem) ?? null;
}

export async function getKnowledgeItemByTranscriptId(
  transcriptId: string,
): Promise<KnowledgeItem | null> {
  const { data, error } = await supabaseAdmin()
    .from("knowledge_items")
    .select("*")
    .eq("assemblyai_transcript_id", transcriptId)
    .maybeSingle();
  if (error) throw error;
  return (data as KnowledgeItem) ?? null;
}

export async function getKnowledgeItemByRunPodJobId(
  jobId: string,
): Promise<KnowledgeItem | null> {
  const { data, error } = await supabaseAdmin()
    .from("knowledge_items")
    .select("*")
    .eq("runpod_job_id", jobId)
    .maybeSingle();
  if (error) throw error;
  return (data as KnowledgeItem) ?? null;
}

export async function updateKnowledgeStatus(
  id: string,
  patch: Partial<
    Pick<
      KnowledgeItem,
      | "process_status"
      | "process_error"
      | "assemblyai_transcript_id"
      | "runpod_job_id"
      | "transcription_provider"
      | "duration_sec"
    >
  >,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("knowledge_items")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteKnowledgeItem(id: string): Promise<{
  media_r2_key: string;
} | null> {
  const { data, error } = await supabaseAdmin()
    .from("knowledge_items")
    .delete()
    .eq("id", id)
    .select("media_r2_key")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { media_r2_key: data.media_r2_key as string };
}

export async function listKnowledgeItems(
  kind?: KnowledgeKind,
): Promise<KnowledgeItem[]> {
  let q = supabaseAdmin()
    .from("knowledge_items")
    .select("*")
    .order("created_at", { ascending: false });
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) throw error;
  return (data as KnowledgeItem[]) ?? [];
}
