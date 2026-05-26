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
  runpod_job_id: string | null;
  /**
   * Full transcription model id chosen at submit time, e.g.
   * `"assemblyai/universal-2"` or `"runpod/whisperx-turbo"`. Lets us
   * attribute usage rows to the right model after the user toggles the
   * setting. Null on legacy rows from before the transcription switch.
   */
  transcription_provider: string | null;
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

export async function getRecordingByRunPodJobId(
  jobId: string,
): Promise<CallRecording | null> {
  const { data, error } = await supabaseAdmin()
    .from("call_recordings")
    .select("*")
    .eq("runpod_job_id", jobId)
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
      | "runpod_job_id"
      | "transcription_provider"
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
