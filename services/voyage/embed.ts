// Voyage embedding wrapper.
//
// Mirrors the previous Gemini service's `embedBatch(texts)` signature so all
// callers can be flipped with an import-path change. Adds an optional
// `inputType` so the retrieval path can pass `"query"` (Voyage recommends
// asymmetric encoding for query-vs-document inputs to nudge retrieval quality).
//
// voyage-4-large limits per request:
//   - up to 1000 texts
//   - up to 120k total tokens
//   - 32k tokens per text
// We batch at 128 texts which keeps us far below both ceilings even for
// long chunks.

import {
  voyageFetch,
  VOYAGE_EMBEDDING_DIM,
  VOYAGE_EMBEDDING_MODEL,
  type VoyageEmbedResponse,
} from "./client";
import { recordVoyageUsage } from "@/services/supabase/queries/voyage-usage";
import { costForEmbed } from "./pricing";

const BATCH = 128;
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 5000;
let dimChecked = false;

async function embedWithRetry(
  slice: string[],
  inputType: "document" | "query",
): Promise<Response> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await voyageFetch("/embeddings", {
      method: "POST",
      body: JSON.stringify({
        input: slice,
        model: VOYAGE_EMBEDDING_MODEL,
        input_type: inputType,
        output_dimension: VOYAGE_EMBEDDING_DIM,
        truncation: true,
      }),
    });
    if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
    // Parse retry-after (seconds) if present; otherwise exponential backoff
    // (5s, 15s, 45s, 135s) — fits Voyage's free-tier 3 RPM / 10K TPM caps.
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : BASE_BACKOFF_MS * Math.pow(3, attempt);
    // Drain body so the connection can be reused.
    try {
      await res.text();
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[voyage] 429 rate-limited; retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(waitMs / 1000)}s`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    attempt++;
  }
}

function assertDimension(sample: number[]): void {
  if (dimChecked) return;
  if (sample.length !== VOYAGE_EMBEDDING_DIM) {
    throw new Error(
      `Voyage returned ${sample.length}-d vector but DB expects ${VOYAGE_EMBEDDING_DIM}. ` +
        `Either update vector(N) columns or the model/output_dimension.`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `[voyage] embedding dim verified = ${sample.length} (${VOYAGE_EMBEDDING_MODEL})`,
  );
  dimChecked = true;
}

export interface EmbedOptions {
  /** "document" (default) for stored chunks, "query" for retrieval inputs. */
  inputType?: "document" | "query";
  /** Logical caller for observability (e.g. "analyze_call", "knowledge_search"). */
  scope?: string;
  /** Related entity id (call id, knowledge item id) when known. */
  scopeId?: string | null;
}

export async function embedBatch(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const inputType = opts.inputType ?? "document";
  const out: number[][] = [];
  let totalTokens = 0;

  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const res = await embedWithRetry(slice, inputType);
    const data = (await res.json()) as VoyageEmbedResponse;
    if (!Array.isArray(data.data) || data.data.length !== slice.length) {
      throw new Error(
        `Voyage returned ${data.data?.length ?? 0} embeddings for ${slice.length} inputs`,
      );
    }
    totalTokens += data.usage?.total_tokens ?? 0;
    // Voyage promises `index` corresponds to the position in `input` but we
    // sort defensively in case ordering ever drifts.
    const ordered = [...data.data].sort((a, b) => a.index - b.index);
    for (const e of ordered) {
      if (!Array.isArray(e.embedding)) {
        throw new Error("Voyage embedding missing values");
      }
      out.push(e.embedding);
    }
  }

  if (out.length > 0) assertDimension(out[0]);

  // Best-effort usage capture — never block on it.
  if (totalTokens > 0) {
    void recordVoyageUsage({
      kind: "embed",
      model: VOYAGE_EMBEDDING_MODEL,
      tokens: totalTokens,
      cost_usd: costForEmbed(VOYAGE_EMBEDDING_MODEL, totalTokens),
      scope: opts.scope ?? null,
      scope_id: opts.scopeId ?? null,
    });
  }

  return out;
}
