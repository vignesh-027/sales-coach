// Build the embedding-text and FTS-text variants of a retrieval query from
// a raw signal string (typically the concatenated call transcript). Today
// both variants are identical — we isolate this helper so we can tune them
// separately later (stopword stripping, FTS-only synonyms, etc.) without
// touching workers.

const QUERY_MAX_CHARS = 8000;

export interface SearchQuery {
  embeddingText: string;
  ftsText: string;
}

export function buildSearchQuery(raw: string): SearchQuery {
  const trimmed = raw.trim().slice(0, QUERY_MAX_CHARS);
  return {
    embeddingText: trimmed,
    ftsText: trimmed,
  };
}
