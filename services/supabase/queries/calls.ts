import { supabaseAdmin } from "../client-admin";

export type CallType = "pre_sale" | "sales_followup" | "sales_closing";
export type CallStatus =
  | "queued"
  | "transcribing"
  | "embedding"
  | "analyzing"
  | "done"
  | "failed";

export interface Call {
  id: string;
  call_type: CallType;
  title: string;
  salesperson_name: string;
  client_name: string;
  salesperson_id: string | null;
  client_id: string | null;
  process_status: CallStatus;
  process_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function createCall(input: {
  call_type: CallType;
  title: string;
  salesperson_name: string;
  client_name: string;
  salesperson_id?: string | null;
  client_id?: string | null;
}): Promise<Call> {
  const { data, error } = await supabaseAdmin()
    .from("calls")
    .insert({
      call_type: input.call_type,
      title: input.title,
      salesperson_name: input.salesperson_name,
      client_name: input.client_name,
      salesperson_id: input.salesperson_id ?? null,
      client_id: input.client_id ?? null,
      process_status: "queued",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Call;
}

export async function getCall(id: string): Promise<Call | null> {
  const { data, error } = await supabaseAdmin()
    .from("calls")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Call) ?? null;
}

export async function listCalls(callType?: CallType): Promise<Call[]> {
  let q = supabaseAdmin()
    .from("calls")
    .select("*")
    .order("created_at", { ascending: false });
  if (callType) q = q.eq("call_type", callType);
  const { data, error } = await q;
  if (error) throw error;
  return (data as Call[]) ?? [];
}

export async function updateCallStatus(
  id: string,
  patch: Partial<Pick<Call, "process_status" | "process_error">>,
): Promise<void> {
  const { error } = await supabaseAdmin().from("calls").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCall(
  id: string,
): Promise<{ media_r2_keys: string[] } | null> {
  const { data: recs } = await supabaseAdmin()
    .from("call_recordings")
    .select("media_r2_key")
    .eq("call_id", id);
  const keys = ((recs as Array<{ media_r2_key: string }>) ?? []).map(
    (r) => r.media_r2_key,
  );
  const { data, error } = await supabaseAdmin()
    .from("calls")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { media_r2_keys: keys };
}
