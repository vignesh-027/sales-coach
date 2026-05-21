/**
 * End-to-end test for the Call pipeline: upload one sales-call recording
 * server-side (bypasses any browser CORS), create the call row, trigger
 * ingest, poll until done/failed, then print the AI report.
 *
 *   PUBLIC_BASE_URL=https://<tunnel>.trycloudflare.com \
 *     npx tsx --env-file=.env.local scripts/test-call-upload.ts
 */
import { readFile, stat } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { r2Client, R2_BUCKET } from "../services/r2/client";
import { signedPutUrl } from "../services/r2/signed-url";
import { supabaseAdmin } from "../services/supabase/client-admin";
import { createCall, deleteCall } from "../services/supabase/queries/calls";
import { createRecording } from "../services/supabase/queries/call-recordings";
import { getCallReport } from "../services/supabase/queries/call-reports";
import { tasks } from "../worker/client";
import type { IngestCallRecordingPayload } from "../worker/ingest-call-recording";

const FILE =
  "/Users/m1/Documents/Sales Coach/Sales Call Recordings/Sales-Closing Evolution Coachin.m4a";
const R2_KEY = `calls/test-evolution-${Date.now()}/${randomUUID()}.m4a`;
const CLIENT_NAME = "Evolution Coaching";
const SALESPERSON = "Sample Rep";

async function r2Has(key: string) {
  try {
    await r2Client().send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
    return true;
  } catch {
    return false;
  }
}

async function cleanupPrior() {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("calls")
    .select("id, title")
    .eq("client_name", CLIENT_NAME)
    .eq("salesperson_name", SALESPERSON);
  for (const row of data ?? []) {
    console.log(`  - deleting prior call ${row.id} "${row.title}"`);
    const res = await deleteCall(row.id as string);
    for (const key of res?.media_r2_keys ?? []) {
      if (await r2Has(key)) {
        await r2Client().send(
          new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }),
        );
      }
    }
  }
}

async function uploadToR2() {
  const bytes = await readFile(FILE);
  const s = await stat(FILE);
  console.log(`  ↑ uploading ${(s.size / 1024 / 1024).toFixed(1)} MB to R2`);
  const url = await signedPutUrl(R2_KEY, "audio/mp4", 60 * 30);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "audio/mp4" },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) {
    throw new Error(`R2 PUT failed ${res.status}: ${await res.text()}`);
  }
  if (!(await r2Has(R2_KEY))) throw new Error("R2 HEAD failed after PUT");
  console.log(`  ✓ R2 PUT verified`);
}

async function poll(callId: string): Promise<boolean> {
  const admin = supabaseAdmin();
  const start = Date.now();
  const timeoutMs = 12 * 60 * 1000;
  let last = "";
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await admin
      .from("calls")
      .select("process_status, process_error")
      .eq("id", callId)
      .single();
    if (error) throw error;
    const status = data.process_status as string;
    const err = data.process_error as string | null;
    const tag = `${status}${err ? ` (${err.slice(0, 120)})` : ""}`;
    if (tag !== last) {
      console.log(`  [${((Date.now() - start) / 1000).toFixed(0)}s] ${tag}`);
      last = tag;
    }
    if (status === "done") return true;
    if (status === "failed") return false;
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("  timeout");
  return false;
}

async function main() {
  const webhookBaseUrl = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  if (!webhookBaseUrl) {
    console.error("PUBLIC_BASE_URL required");
    process.exit(1);
  }
  console.log(`webhook base: ${webhookBaseUrl}`);

  console.log("\n=== cleanup ===");
  await cleanupPrior();

  console.log("\n=== upload ===");
  await uploadToR2();

  console.log("\n=== create call + recording + trigger ===");
  const call = await createCall({
    call_type: "sales_closing",
    title: `${CLIENT_NAME} · sales-closing · test`,
    salesperson_name: SALESPERSON,
    client_name: CLIENT_NAME,
  });
  console.log(`  + call ${call.id}`);

  const rec = await createRecording({
    call_id: call.id,
    recording_index: 0,
    media_r2_key: R2_KEY,
    media_type: "m4a",
    source_format: "audio",
    webhook_secret: randomBytes(24).toString("hex"),
  });
  console.log(`  + recording ${rec.id}`);

  const payload: IngestCallRecordingPayload = {
    callId: call.id,
    recordingId: rec.id,
    webhookBaseUrl,
  };
  const handle = await tasks.trigger<
    typeof import("../worker/ingest-call-recording").ingestCallRecording
  >("ingest-call-recording", payload);
  console.log(`  ▶ run ${handle.id}`);

  console.log("\n=== poll ===");
  const ok = await poll(call.id);
  if (!ok) {
    console.log("\n❌ FAILED");
    process.exit(1);
  }

  console.log("\n=== fetching report ===");
  const report = await getCallReport(call.id);
  if (!report) {
    console.log("❌ no report row");
    process.exit(1);
  }
  console.log(
    `  tokens: input=${report.input_tokens} output=${report.output_tokens}`,
  );
  console.log(`  model: ${report.model} v${report.prompt_version}`);
  console.log("\n--- REPORT ---");
  console.log(JSON.stringify(report.report, null, 2));
  console.log("\n✅ SUCCESS");
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
