import { supabaseAdmin } from "../client-admin";
import type { TranscriptSegment } from "./transcripts";

export async function insertCallTranscript(input: {
  call_recording_id: string;
  full_text: string;
  segments: TranscriptSegment[];
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("call_transcripts")
    .upsert(
      {
        call_recording_id: input.call_recording_id,
        full_text: input.full_text,
        segments: input.segments,
      },
      { onConflict: "call_recording_id" },
    );
  if (error) throw error;
}

export async function getCallTranscript(
  callRecordingId: string,
): Promise<{ full_text: string; segments: TranscriptSegment[] } | null> {
  const { data, error } = await supabaseAdmin()
    .from("call_transcripts")
    .select("full_text, segments")
    .eq("call_recording_id", callRecordingId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    full_text: data.full_text as string,
    segments: data.segments as TranscriptSegment[],
  };
}

export interface OrderedCallTranscript {
  call_recording_id: string;
  recording_index: number;
  full_text: string;
  segments: TranscriptSegment[];
}

export async function listCallTranscriptsOrdered(
  callId: string,
): Promise<OrderedCallTranscript[]> {
  const { data, error } = await supabaseAdmin()
    .from("call_recordings")
    .select(
      "id, recording_index, call_transcripts!inner(full_text, segments)",
    )
    .eq("call_id", callId)
    .order("recording_index", { ascending: true });
  if (error) throw error;
  type Row = {
    id: string;
    recording_index: number;
    call_transcripts: { full_text: string; segments: TranscriptSegment[] };
  };
  return ((data as unknown as Row[]) ?? []).map((r) => ({
    call_recording_id: r.id,
    recording_index: r.recording_index,
    full_text: r.call_transcripts.full_text,
    segments: r.call_transcripts.segments,
  }));
}
