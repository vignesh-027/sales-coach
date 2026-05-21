/**
 * End-to-end smoke test for the knowledge ingestion pipeline,
 * bypassing the Trigger.dev worker (uses synchronous polling instead).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/smoke-test.ts <path-to-audio-file>
 *
 * What it does:
 *   1. Reads a local audio file
 *   2. Generates an R2 key, uploads via signed PUT
 *   3. Creates a knowledge_items row directly via Supabase admin client
 *   4. Generates a signed GET URL, submits to AssemblyAI (no webhook; polls)
 *   5. Waits for completion, writes transcript row
 *   6. Chunks + embeds via Voyage, inserts knowledge_chunks
 *   7. Sets status=done, then runs a similarity search to sanity-check retrieval
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

import { signedPutUrl, signedGetUrl } from "../services/r2/signed-url";
import {
  createKnowledgeItem,
  updateKnowledgeStatus,
  getKnowledgeItem,
} from "../services/supabase/queries/knowledge-items";
import { insertTranscript } from "../services/supabase/queries/transcripts";
import {
  bulkInsertChunks,
  similaritySearch,
} from "../services/supabase/queries/knowledge-chunks";
import { aaiFetch } from "../services/assemblyai/client";
import { embedBatch } from "../services/voyage/embed";
import { chunkTranscript } from "../lib/chunker";

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

async function submitAndPoll(audioUrl: string): Promise<{
  fullText: string;
  durationSec: number | null;
  segments: Array<{
    speaker: string;
    start_ms: number;
    end_ms: number;
    text: string;
  }>;
}> {
  const submitRes = await aaiFetch("/transcript", {
    method: "POST",
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: ["universal-2"],
      speaker_labels: true,
    }),
  });
  const submitted = (await submitRes.json()) as { id: string };
  console.log(`  submitted AssemblyAI job ${submitted.id}; polling…`);

  let attempt = 0;
  while (true) {
    attempt++;
    await new Promise((r) => setTimeout(r, 5000));
    const res = await aaiFetch(`/transcript/${submitted.id}`);
    const data = (await res.json()) as {
      status: string;
      text: string | null;
      audio_duration: number | null;
      error: string | null;
      utterances:
        | Array<{ start: number; end: number; text: string; speaker: string }>
        | null;
    };
    if (attempt % 6 === 0)
      console.log(`  poll ${attempt}: status=${data.status}`);
    if (data.status === "completed") {
      const segments = (data.utterances ?? []).map((u) => ({
        speaker: u.speaker,
        start_ms: u.start,
        end_ms: u.end,
        text: u.text,
      }));
      return {
        fullText: data.text ?? "",
        durationSec: data.audio_duration,
        segments,
      };
    }
    if (data.status === "error") {
      throw new Error(`AssemblyAI error: ${data.error}`);
    }
    if (attempt > 240) throw new Error("AssemblyAI polling timed out (20 min)");
  }
}

async function main() {
  const argFile = process.argv[2];
  if (!argFile) {
    console.error("Usage: tsx scripts/smoke-test.ts <audio-file>");
    process.exit(1);
  }

  console.log(`> reading ${argFile}`);
  const bytes = await readFile(argFile);
  const ext = extname(argFile).replace(/^\./, "").toLowerCase() || "bin";
  const contentType =
    ext === "mp3"
      ? "audio/mpeg"
      : ext === "m4a"
        ? "audio/mp4"
        : ext === "wav"
          ? "audio/wav"
          : ext === "mp4"
            ? "video/mp4"
            : "application/octet-stream";

  const r2Key = `knowledge/smoke/${randomUUID()}.${ext}`;
  console.log(`> uploading to R2: ${r2Key} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
  await uploadToR2(r2Key, contentType, bytes);

  console.log(`> inserting knowledge_items row`);
  const item = await createKnowledgeItem({
    kind: "founder_video",
    title: `SMOKE: ${basename(argFile)}`,
    description: "smoke-test entry",
    media_r2_key: r2Key,
    media_type: ext,
    source_format: ext === "mp3" || ext === "m4a" || ext === "wav" ? "audio" : "video",
    webhook_secret: randomBytes(16).toString("hex"),
  });
  console.log(`  knowledge_item_id=${item.id}`);

  console.log(`> generating signed GET URL for AssemblyAI`);
  const getUrl = await signedGetUrl(r2Key, 60 * 60 * 6);

  console.log(`> transcribing via AssemblyAI`);
  await updateKnowledgeStatus(item.id, { process_status: "transcribing" });
  const transcript = await submitAndPoll(getUrl);
  console.log(
    `  transcript ready: ${transcript.fullText.length} chars · ${transcript.segments.length} utterances · ${transcript.durationSec ?? "?"}s`,
  );

  await insertTranscript({
    knowledge_item_id: item.id,
    full_text: transcript.fullText,
    segments: transcript.segments,
  });
  await updateKnowledgeStatus(item.id, {
    process_status: "embedding",
    duration_sec: transcript.durationSec ? Math.round(transcript.durationSec) : null,
  });

  console.log(`> chunking`);
  const chunks = chunkTranscript(transcript.segments);
  console.log(`  ${chunks.length} chunks`);

  console.log(`> embedding with Voyage`);
  const vectors = await embedBatch(chunks.map((c) => c.text));
  console.log(`  ${vectors.length} vectors, dim=${vectors[0]?.length}`);

  console.log(`> inserting knowledge_chunks`);
  await bulkInsertChunks(
    chunks.map((c, i) => ({
      knowledge_item_id: item.id,
      chunk_index: i,
      chunk_text: c.text,
      start_ts_ms: c.start_ts_ms,
      end_ts_ms: c.end_ts_ms,
      embedding: vectors[i],
    })),
  );

  await updateKnowledgeStatus(item.id, { process_status: "done" });
  const final = await getKnowledgeItem(item.id);
  console.log(`> done. final status=${final?.process_status}`);

  console.log(`> sanity-check retrieval: "objection handling about price"`);
  const [qVec] = await embedBatch(["objection handling about price"]);
  try {
    const hits = await similaritySearch(qVec, 3);
    for (const h of hits) {
      console.log(
        `  ${h.distance.toFixed(3)}  chunk#${h.chunk_index}  ${h.chunk_text.slice(0, 100).replace(/\s+/g, " ")}…`,
      );
    }
  } catch (err) {
    console.warn(
      `  (similaritySearch RPC not deployed yet — run the 0001-init migration including knowledge_chunks_search)`,
      err instanceof Error ? err.message : err,
    );
  }
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
