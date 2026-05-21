import { supabaseAdmin } from "../client-admin";
import {
  CallReportSchema,
  type CallReport,
} from "@/services/anthropic/call-report-schema";

export interface CallReportRow {
  call_id: string;
  model: string;
  prompt_version: number;
  report: CallReport;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export async function upsertCallReport(input: {
  call_id: string;
  model: string;
  prompt_version: number;
  report: CallReport;
  input_tokens: number;
  output_tokens: number;
}): Promise<void> {
  // Defense-in-depth: never write a structurally-invalid report to the DB,
  // even if a caller bypassed runAnalysis's validation. jsonb won't enforce
  // shape, the UI won't tolerate it — so reject here.
  const parsed = CallReportSchema.safeParse(input.report);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join(" | ");
    throw new Error(
      `upsertCallReport refused: report failed schema validation. issues=[${issues}]`,
    );
  }
  const { error } = await supabaseAdmin()
    .from("call_reports")
    .upsert(
      {
        call_id: input.call_id,
        model: input.model,
        prompt_version: input.prompt_version,
        report: parsed.data,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        created_at: new Date().toISOString(),
      },
      { onConflict: "call_id" },
    );
  if (error) throw error;
}

// Per-model Claude token rollup for /admin/observability. Sums input/output
// tokens grouped by model over the last `days`. Old rows with NULL token
// counts (pre-tracking) contribute zero. Unlike Voyage there's no free tier,
// so this is real paid spend — but per current spec we surface tokens only.
export interface ClaudeUsageRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
}

export async function claudeUsageLastNDays(
  days: number,
): Promise<ClaudeUsageRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("call_reports")
    .select("model, input_tokens, output_tokens")
    .gte("created_at", since);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
  }>;
  const buckets = new Map<string, ClaudeUsageRow>();
  for (const r of rows) {
    const cur = buckets.get(r.model) ?? {
      model: r.model,
      input_tokens: 0,
      output_tokens: 0,
    };
    cur.input_tokens += r.input_tokens ?? 0;
    cur.output_tokens += r.output_tokens ?? 0;
    buckets.set(r.model, cur);
  }
  return Array.from(buckets.values()).sort(
    (a, b) =>
      b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens),
  );
}

export async function getCallReport(
  callId: string,
): Promise<CallReportRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("call_reports")
    .select("*")
    .eq("call_id", callId)
    .maybeSingle();
  if (error) throw error;
  return (data as CallReportRow) ?? null;
}
