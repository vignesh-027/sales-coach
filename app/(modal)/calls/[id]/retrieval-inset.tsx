"use client";

import { useEffect, useState } from "react";

interface RetrievedChunk {
  source: "call" | "knowledge";
  parent_id: string;
  parent_title: string;
  snippet: string;
  vector_rank: number | null;
  fts_rank: number | null;
  fused_score: number | null;
  rerank_score: number | null;
  kept: boolean;
}

interface Row {
  id: string;
  call_id: string;
  created_at: string;
  query_text: string | null;
  vector_hits: number;
  fts_hits: number;
  fused_candidates: number;
  rerank_kept: number;
  rerank_dropped: number;
  rerank_fallback_used: boolean;
  rerank_model: string | null;
  retrieved_chunks: RetrievedChunk[];
}

interface ApiResponse {
  historical: boolean;
  row: Row | null;
  note?: string;
}

export function CallRetrievalInset({ callId }: { callId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/calls/${callId}/retrieval`);
        if (!res.ok) throw new Error(await res.text());
        const j = (await res.json()) as ApiResponse;
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId]);

  if (err) {
    return (
      <div className="stats-card" style={{ marginTop: 16 }}>
        <div className="stats-warn">retrieval inset unavailable: {err}</div>
      </div>
    );
  }
  if (!data) return null;

  if (data.historical || !data.row) {
    return (
      <div className="stats-card" style={{ marginTop: 16 }}>
        <div className="stats-line" style={{ opacity: 0.7 }}>
          {data.note ??
            "Historical run — detailed retrieval metrics not captured."}
        </div>
      </div>
    );
  }

  const r = data.row;
  return (
    <div className="stats-card" style={{ marginTop: 16 }}>
      <div className="stats-line">
        <span className="k">retrieval</span>
        <span className="v">vector {r.vector_hits}</span>
        <span className="k">·</span>
        <span className="v">fts {r.fts_hits}</span>
        <span className="k">·</span>
        <span className="v">fused {r.fused_candidates}</span>
        <span className="k">·</span>
        <span className="v">kept {r.rerank_kept}</span>
        <span className="k">·</span>
        <span className="v">dropped {r.rerank_dropped}</span>
        {r.rerank_fallback_used && (
          <>
            <span className="k">·</span>
            <span className="v">fallback used</span>
          </>
        )}
        <span className="k">·</span>
        <span className="v">{r.rerank_model ?? "—"}</span>
      </div>
      <button
        type="button"
        className="stats-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "hide chunks" : `show ${r.retrieved_chunks.length} candidates`}
      </button>
      {open && (
        <div className="vec-sample">
          {r.retrieved_chunks.map((c, i) => (
            <div
              key={i}
              style={{
                marginBottom: 8,
                opacity: c.kept ? 1 : 0.55,
              }}
            >
              <div>
                {c.kept ? "✓" : "—"} score=
                {c.rerank_score != null ? c.rerank_score.toFixed(4) : "—"}
                {" · "}v={c.vector_rank ?? "-"} f={c.fts_rank ?? "-"} fused=
                {c.fused_score != null ? c.fused_score.toFixed(4) : "—"}
                {" · "}
                {c.parent_title}
              </div>
              <div style={{ marginTop: 2, opacity: 0.75 }}>
                “{c.snippet}…”
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
