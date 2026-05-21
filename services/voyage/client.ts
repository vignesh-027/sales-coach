// Voyage AI client + model constants.
//
// We talk to Voyage's REST API directly rather than pulling in another SDK.
// The endpoint is stable and the surface we need (single POST /embeddings)
// is tiny.
//
const VOYAGE_BASE_URL = "https://api.voyageai.com/v1";

export const VOYAGE_EMBEDDING_MODEL = "voyage-4-large";
export const VOYAGE_EMBEDDING_DIM = 1024;

function resolveApiKey(): string {
  const apiKey = process.env.Voyage_API_Key;
  if (!apiKey) throw new Error("Missing Voyage_API_Key");
  return apiKey;
}

let cachedKey: string | null = null;

function voyageKey(): string {
  if (!cachedKey) cachedKey = resolveApiKey();
  return cachedKey;
}

export interface VoyageEmbedRequest {
  input: string[];
  model: string;
  input_type?: "document" | "query" | null;
  output_dimension?: number;
  truncation?: boolean;
}

export interface VoyageEmbedResponse {
  object: "list";
  data: Array<{ object: "embedding"; embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

export async function voyageFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const res = await fetch(`${VOYAGE_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${voyageKey()}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Voyage ${path} failed: ${res.status} ${res.statusText} :: ${text.slice(0, 500)}`,
    );
  }
  return res;
}
