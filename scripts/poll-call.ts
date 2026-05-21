import { supabaseAdmin } from "../services/supabase/client-admin";
import { getCallReport } from "../services/supabase/queries/call-reports";

const callId = process.argv[2];
if (!callId) {
  console.error("usage: poll-call.ts <call_id>");
  process.exit(2);
}

async function main() {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < 10 * 60 * 1000) {
    const { data } = await supabaseAdmin()
      .from("calls")
      .select("process_status, process_error")
      .eq("id", callId)
      .single();
    const s = data!.process_status as string;
    const e = data!.process_error as string | null;
    const tag = `${s}${e ? ` (${e.slice(0, 140)})` : ""}`;
    if (tag !== last) {
      console.log(`[${((Date.now() - start) / 1000).toFixed(0)}s] ${tag}`);
      last = tag;
    }
    if (s === "done") {
      const r = await getCallReport(callId);
      console.log(
        "\ntokens:",
        r?.input_tokens,
        "in /",
        r?.output_tokens,
        "out",
      );
      console.log("\n--- REPORT ---");
      console.log(JSON.stringify(r?.report, null, 2));
      process.exit(0);
    }
    if (s === "failed") process.exit(1);
    await new Promise((r) => setTimeout(r, 5000));
  }
  process.exit(2);
}

void main();
