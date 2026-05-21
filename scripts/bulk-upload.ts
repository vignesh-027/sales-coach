/**
 * Bulk-upload every file under Knowledge Source/ to R2 + Supabase, then trigger
 * the ingest-knowledge worker for each. Skips files that already exist in R2
 * AND have a knowledge_items row (dedup).
 *
 * Usage:
 *   PUBLIC_BASE_URL=https://<tunnel>.trycloudflare.com \
 *     npx tsx --env-file=.env.local scripts/bulk-upload.ts
 */
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { HeadObjectCommand } from "@aws-sdk/client-s3";

import { r2Client, R2_BUCKET } from "../services/r2/client";
import { signedPutUrl } from "../services/r2/signed-url";
import { supabaseAdmin } from "../services/supabase/client-admin";
import {
  createKnowledgeItem,
  type KnowledgeKind,
} from "../services/supabase/queries/knowledge-items";
import { tasks } from "../worker/client";
import type { IngestKnowledgePayload } from "../worker/ingest-knowledge";

const ROOT = "/Users/m1/Documents/Sales Coach/Knowledge Source";

const FOLDERS: Array<{ dir: string; kind: KnowledgeKind }> = [
  { dir: "Founder:Product", kind: "founder_video" },
  { dir: "Sales-Closing", kind: "reference_call" },
];

const MEDIA_EXTS = new Set(["mp3", "m4a", "wav", "mp4"]);

function contentTypeFor(ext: string): string {
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function r2Has(key: string): Promise<boolean> {
  try {
    await r2Client().send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
    return true;
  } catch {
    return false;
  }
}

async function supabaseHas(mediaKey: string): Promise<{
  id: string;
  status: string;
} | null> {
  const { data, error } = await supabaseAdmin()
    .from("knowledge_items")
    .select("id, process_status")
    .eq("media_r2_key", mediaKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id as string, status: data.process_status as string };
}

async function uploadToR2(key: string, contentType: string, body: Buffer) {
  const url = await signedPutUrl(key, contentType, 60 * 30);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    throw new Error(`R2 PUT failed ${res.status}: ${await res.text()}`);
  }
}

async function processFile(
  fullPath: string,
  fileName: string,
  kind: KnowledgeKind,
  webhookBaseUrl: string,
) {
  const ext = extname(fileName).replace(/^\./, "").toLowerCase();
  if (!MEDIA_EXTS.has(ext)) {
    console.log(`  skip (non-media): ${fileName}`);
    return;
  }
  const stats = await stat(fullPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

  const slug = slugify(fileName);
  const r2Key = `knowledge/${kind}/${slug}.${ext}`;
  const title = fileName.replace(/\.[^.]+$/, "");

  // Dedup: existing Supabase row OR existing R2 object?
  const dbRow = await supabaseHas(r2Key);
  const r2Exists = await r2Has(r2Key);

  if (dbRow && r2Exists) {
    console.log(
      `  ✓ skip (already ingested ${dbRow.status}): ${fileName}  [${r2Key}]`,
    );
    return;
  }
  if (dbRow && !r2Exists) {
    console.log(
      `  ! row exists in Supabase but missing in R2 → re-upload only: ${fileName}`,
    );
  }
  if (!dbRow && r2Exists) {
    console.log(
      `  ! file in R2 but no Supabase row → reuse R2, insert row: ${fileName}`,
    );
  }

  if (!r2Exists) {
    console.log(`  ↑ uploading to R2 (${sizeMB} MB): ${r2Key}`);
    const bytes = await readFile(fullPath);
    await uploadToR2(r2Key, contentTypeFor(ext), bytes);
  }

  let itemId: string;
  if (dbRow) {
    itemId = dbRow.id;
  } else {
    const item = await createKnowledgeItem({
      kind,
      title,
      description: `Imported via bulk-upload from ${kind} folder`,
      media_r2_key: r2Key,
      media_type: ext,
      source_format: ext === "mp4" ? "video" : "audio",
      webhook_secret: randomBytes(16).toString("hex"),
    });
    itemId = item.id;
    console.log(`  + Supabase row: ${itemId}`);
  }

  const payload: IngestKnowledgePayload = {
    knowledgeItemId: itemId,
    webhookBaseUrl,
  };
  const handle = await tasks.trigger<
    typeof import("../worker/ingest-knowledge").ingestKnowledge
  >("ingest-knowledge", payload);
  console.log(`  ▶ triggered ingest-knowledge run=${handle.id}`);
}

async function main() {
  const webhookBaseUrl = (
    process.env.PUBLIC_BASE_URL ?? ""
  ).replace(/\/$/, "");
  if (!webhookBaseUrl) {
    console.error("PUBLIC_BASE_URL is required (the public tunnel URL).");
    process.exit(1);
  }
  console.log(`webhook base: ${webhookBaseUrl}`);

  const { readdir } = await import("node:fs/promises");
  for (const { dir, kind } of FOLDERS) {
    const folder = join(ROOT, dir);
    console.log(`\n=== ${dir} (kind=${kind}) ===`);
    let files: string[];
    try {
      files = await readdir(folder);
    } catch (err) {
      console.warn(`  cannot read ${folder}:`, err);
      continue;
    }
    files.sort();
    for (const f of files) {
      const fullPath = join(folder, f);
      try {
        await processFile(fullPath, f, kind, webhookBaseUrl);
      } catch (err) {
        console.error(`  FAILED ${f}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log("\nbulk-upload complete.");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
