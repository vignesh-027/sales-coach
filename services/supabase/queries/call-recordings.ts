import { supabaseAdmin } from "../client-admin";

export type RecordingStatus = "queued" | "transcribing" | "done" | "failed";
export type CallSourceFormat = "audio" | "video";

export interface CallRecording {
  id: string;
  call_id: string;
  recording_index: number;
  media_r2_key: string;
  media_type: string;
  source_format: CallSourceFormat;
  duration_sec: number | null;
  assemblyai_transcript_id: string | null;
  webhook_secret: string;
  transcribe_status: RecordingStatus;
  transcribe_error: string | null;
  created_at: string;
}

export async function createRecording(input: {
  call_id: string;
  recording_index: number;
  media_r2_key: string;
  media_type: string;
  source_format: CallSourceFormat;
  webhook_secret: string;
}): Promise<CallRecording> {
  const { data, error } = await supabaseAdmin()
    .from("call_recordings")
    .insert({
      call_id: input.call_id,
      recording_index: input.recording_index,
      media_r2_key: input.media_r2_key,
      media_type: input.media_type,
      source_format: input.source_format,
      webhook_secret: input.webhook_secret,
      transcribe_status: "queued",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CallRecording;
}

export async function getRecording(id: string): Promise<CallRecording | null> {
  const { data, error } = await supabaseAdmin()
    .from("call_recordings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as CallRecording) ?? null;
}

export async function getRecordingByTranscriptId(
  transcriptId: string,
): Promise<CallRecording | null> {
  const { data, error } = await supabaseAdmin()
    .from("call_recordings")
    .select("*")
    .eq("assemblyai_transcript_id", transcriptId)
    .maybeSingle();
  if (error) throw error;
  return (data as CallRecording) ?? null;
}

export async function listRecordings(callId: string): Promise<CallRecording[]> {
  const { data, error } = await supabaseAdmin()
    .from("call_recordings")
    .select("*")
    .eq("call_id", callId)
    .order("recording_index", { ascending: true });
  if (error) throw error;
  return (data as CallRecording[]) ?? [];
}

export async function updateRecording(
  id: string,
  patch: Partial<
    Pick<
      CallRecording,
      | "transcribe_status"
      | "transcribe_error"
      | "assemblyai_transcript_id"
      | "duration_sec"
    >
  >,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("call_recordings")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function allRecordingsDone(callId: string): Promise<boolean> {
  const recs = await listRecordings(callId);
  if (recs.length === 0) return false;
  return recs.every((r) => r.transcribe_status === "done");
}
