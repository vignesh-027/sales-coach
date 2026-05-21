import { supabaseAdmin } from "../client-admin";

export interface TranscriptSegment {
  speaker: string;
  start_ms: number;
  end_ms: number;
  text: string;
}

export async function insertTranscript(input: {
  knowledge_item_id: string;
  full_text: string;
  segments: TranscriptSegment[];
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("transcripts")
    .upsert(
      {
        knowledge_item_id: input.knowledge_item_id,
        full_text: input.full_text,
        segments: input.segments,
      },
      { onConflict: "knowledge_item_id" },
    );
  if (error) throw error;
}

export async function getTranscript(
  knowledgeItemId: string,
): Promise<{ full_text: string; segments: TranscriptSegment[] } | null> {
  const { data, error } = await supabaseAdmin()
    .from("transcripts")
    .select("full_text, segments")
    .eq("knowledge_item_id", knowledgeItemId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    full_text: data.full_text as string,
    segments: data.segments as TranscriptSegment[],
  };
}
