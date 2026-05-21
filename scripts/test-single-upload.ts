/**
 * End-to-end test: upload Accelerated Success Story.mp4 server-side, trigger
 * ingest, poll until done/failed.
 *
 *   PUBLIC_BASE_URL=https://<tunnel>.trycloudflare.com \
 *     npx tsx --env-file=.env.local scripts/test-single-upload.ts
 */
import { readFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { r2Client, R2_BUCKET } from "../services/r2/client";
import { signedPutUrl } from "../services/r2/signed-url";
import { supabaseAdmin } from "../services/supabase/client-admin";
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
} from "../services/supabase/queries/knowledge-items";
import { tasks } from "../worker/client";
import type { IngestKnowledgePayload } from "../worker/ingest-knowledge";

const FILE =
  "/Users/m1/Documents/Sales Coach/Knowledge Source/Founder:Product/Accelerated Success Story.mp4";
const R2_KEY = "knowledge/founder_video/accelerated-success-story.mp4";
const TITLE = "Accelerated Success Story";

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

async function cleanup() {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("knowledge_items")
    .select("id, process_status, media_r2_key")
    .eq("media_r2_key", R2_KEY);
  for (const row of data ?? []) {
    console.log(`  - deleting existing row ${row.id} status=${row.process_status}`);
    await deleteKnowledgeItem(row.id as string);
  }
  if (await r2Has(R2_KEY)) {
    console.log(`  - deleting existing R2 object ${R2_KEY}`);
    await r2Client().send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: R2_KEY }),
    );
  }
}

async function uploadToR2() {
  const bytes = await readFile(FILE);
  const s = await stat(FILE);
  console.log(`  ↑ uploading ${(s.size / 1024 / 1024).toFixed(1)} MB to R2`);
  const url = await signedPutUrl(R2_KEY, "video/mp4", 60 * 30);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "video/mp4" },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) {
    throw new Error(`R2 PUT failed ${res.status}: ${await res.text()}`);
  }
  // Verify via HEAD
  const ok = await r2Has(R2_KEY);
  if (!ok) throw new Error("R2 HEAD failed after PUT");
  console.log(`  ✓ R2 PUT verified`);
}

async function poll(itemId: string, webhookBaseUrl: string) {
  const admin = supabaseAdmin();
  const start = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  let last = "";
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await admin
      .from("knowledge_items")
      .select("process_status, process_error")
      .eq("id", itemId)
      .single();
    if (error) throw error;
    const status = data.process_status as string;
    const err = data.process_error as string | null;
    const tag = `${status}${err ? ` (${err.slice(0, 100)})` : ""}`;
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
  await cleanup();

  console.log("\n=== upload ===");
  await uploadToR2();

  console.log("\n=== create row + trigger ===");
  const item = await createKnowledgeItem({
    kind: "founder_video",
    title: TITLE,
    description: "End-to-end test upload",
    media_r2_key: R2_KEY,
    media_type: "mp4",
    source_format: "video",
    webhook_secret: randomBytes(16).toString("hex"),
  });
  console.log(`  + row ${item.id}`);

  const payload: IngestKnowledgePayload = {
    knowledgeItemId: item.id,
    webhookBaseUrl,
  };
  const handle = await tasks.trigger<
    typeof import("../worker/ingest-knowledge").ingestKnowledge
  >("ingest-knowledge", payload);
  console.log(`  ▶ run ${handle.id}`);

  console.log("\n=== poll ===");
  const ok = await poll(item.id, webhookBaseUrl);
  console.log(ok ? "\n✅ SUCCESS" : "\n❌ FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
