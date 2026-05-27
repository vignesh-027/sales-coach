"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { VOYAGE_EMBEDDING_DIM } from "@/services/voyage/client";
import { KnowledgeUsageInset } from "./usage-inset";

type SourceFormat = "audio" | "video" | "text";

interface MediaInfo {
  url: string;
  media_type: string;
  source_format: SourceFormat;
}

interface Segment {
  speaker?: string;
  start?: number;
  end?: number;
  start_ms?: number;
  end_ms?: number;
  text: string;
}

interface TranscriptInfo {
  full_text: string;
  segments: Segment[];
}

interface KnowledgeItem {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  source_format: SourceFormat;
  media_type: string;
  process_status: string;
  process_error: string | null;
  duration_sec: number | null;
  created_at: string;
}

interface ChunkStats {
  chunks_total: number;
  chunks_with_embedding: number;
  embedding_dims: number | null;
  min_norm: number | null;
  max_norm: number | null;
  avg_norm: number | null;
  duplicate_indexes: number;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

interface ChunkSample {
  chunk_index: number;
  chunk_text_preview: string;
  embedding_head: number[];
  embedding_tail: number[];
  embedding_length: number;
}

function fmtTs(ms?: number): string {
  if (ms == null) return "";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function KnowledgeDetailClient({
  id,
  isAdmin = false,
}: {
  id: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [item, setItem] = useState<KnowledgeItem | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [transcript, setTranscript] = useState<TranscriptInfo | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [stats, setStats] = useState<ChunkStats | null>(null);
  const [sample, setSample] = useState<ChunkSample | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [showVec, setShowVec] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryErr, setRetryErr] = useState<string | null>(null);

  // Bumped after a successful rerun so both polling effects pick up the
  // new server state without requiring a full page reload.
  const [pollKey, setPollKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function load() {
      const [itemRes, mediaRes, trRes] = await Promise.all([
        fetch(`/api/knowledge`, { cache: "no-store" })
          .then((r) => r.json())
          .then((j) => (j.items as KnowledgeItem[]).find((i) => i.id === id)),
        fetch(`/api/knowledge/${id}/media-url`, { cache: "no-store" }).then(
          (r) => (r.ok ? r.json() : null),
        ),
        fetch(`/api/knowledge/${id}/transcript`, { cache: "no-store" }).then(
          (r) => r.json(),
        ),
      ]);
      if (cancelled) return;
      setItem(itemRes ?? null);
      setMedia(mediaRes as MediaInfo | null);
      setTranscript((trRes as { transcript: TranscriptInfo | null }).transcript);
      // Stop polling once processing has settled.
      if (itemRes && (itemRes.process_status === "done" || itemRes.process_status === "failed") && timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    void load();
    timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [id, pollKey]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function loadStats() {
      try {
        const r = await fetch(`/api/knowledge/${id}/chunks`, { cache: "no-store" });
        if (!r.ok) throw new Error(await r.text());
        const j = (await r.json()) as { stats: ChunkStats | null; sample: ChunkSample | null };
        if (cancelled) return;
        setStats(j.stats);
        setSample(j.sample);
        setStatsErr(null);
      } catch (e) {
        if (cancelled) return;
        setStatsErr(e instanceof Error ? e.message : String(e));
      }
    }
    void loadStats();
    timer = setInterval(loadStats, 10000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [id, pollKey]);

  // For text docs, prefer transcript.full_text; fall back to the signed URL.
  useEffect(() => {
    if (media?.source_format !== "text" || textContent) return;
    if (transcript?.full_text) {
      setTextContent(transcript.full_text);
      return;
    }
    if (!media.url) return;
    void fetch(media.url)
      .then((r) => r.text())
      .then(setTextContent)
      .catch(() => setTextContent("(unable to load text file)"));
  }, [media, textContent, transcript]);

  async function doDelete() {
    setDeleting(true);
    setDelErr(null);
    try {
      const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.push("/knowledge");
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  const modalHeader = (
    <header className="top-bar">
      <Link href="/knowledge" className="back" aria-label="Back to knowledge">
        <span className="ico">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="3" x2="11" y2="11" />
            <line x1="11" y1="3" x2="3" y2="11" />
          </svg>
        </span>
        <span className="lbl">Close</span>
      </Link>
      <span className="modal-title">Knowledge detail</span>
      <span />
    </header>
  );

  if (!item) {
    return (
      <div className="modal-shell">
        {modalHeader}
        <main className="detail-shell">
          <p className="loading-mono">loading…</p>
        </main>
      </div>
    );
  }

  const fmtAdded = new Date(item.created_at)
    .toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    .toLowerCase();

  return (
    <div className="modal-shell">
      {modalHeader}
      <main className="detail-shell">
        <div className="detail-head">
          <h1>{item.title}</h1>
          {item.description && (
            <p
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 15,
                color: "var(--ink-2)",
                marginTop: 8,
                maxWidth: 720,
              }}
            >
              {item.description}
            </p>
          )}
          <div className="meta" style={{ marginTop: 16 }}>
            <span>{item.source_format}</span>
            <span>·</span>
            <span>{item.kind.replace("_", " ")}</span>
            <span>·</span>
            <span>.{item.media_type}</span>
            <span>·</span>
            <span>added {fmtAdded}</span>
            <span>·</span>
            <span style={{ color: item.process_status === "done" ? "var(--accent)" : item.process_status === "failed" ? "#b3413f" : "var(--ink-2)" }}>
              {item.process_status}
            </span>
            {isAdmin && (
              <button
                type="button"
                className="delete-link"
                onClick={() => setConfirmOpen(true)}
              >
                Delete
              </button>
            )}
          </div>
          {item.process_status === "failed" && (
            <div
              className="stats-warn"
              style={{
                marginTop: 12,
                maxWidth: 720,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {item.process_error && <div>{item.process_error}</div>}
              <button
                type="button"
                className="retry-btn-inline"
                onClick={async () => {
                  setRetrying(true);
                  try {
                    const r = await fetch(`/api/knowledge/${id}`, {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "start" }),
                    });
                    if (!r.ok) {
                      const txt = await r.text();
                      throw new Error(txt || `http ${r.status}`);
                    }
                    // Status will flip on next poll; force a fresh fetch.
                    router.refresh();
                  } catch (e) {
                    setRetryErr(e instanceof Error ? e.message : String(e));
                  } finally {
                    setRetrying(false);
                  }
                }}
                disabled={retrying}
                style={{ alignSelf: "flex-start" }}
              >
                {retrying ? "Retrying…" : "Retry"}
              </button>
              {retryErr && (
                <div style={{ opacity: 0.85 }}>retry failed: {retryErr}</div>
              )}
            </div>
          )}
        </div>

        {(() => {
          // Hide the entire admin embedding-debug block when chunks are
          // present, the right dimensionality, and there are no duplicates.
          // When unhealthy or still processing, render the box so admins can
          // see what's wrong and click "Rerun embedding".
          const inFlight =
            item.process_status === "queued" ||
            item.process_status === "transcribing" ||
            item.process_status === "embedding" ||
            item.process_status === "analyzing";
          const embeddingHealthy =
            stats !== null &&
            stats.chunks_total > 0 &&
            (stats.embedding_dims == null ||
              stats.embedding_dims === VOYAGE_EMBEDDING_DIM) &&
            stats.duplicate_indexes === 0 &&
            item.process_status === "done";
          if (embeddingHealthy || inFlight) return null;
          return (
        <div className="stats-card">
          {statsErr ? (
            <div className="stats-warn">stats unavailable: {statsErr}</div>
          ) : !stats ? (
            <p className="loading-mono">loading embedding stats…</p>
          ) : stats.chunks_total === 0 ? (
            <>
              <p className="loading-mono">
                no embedding chunks yet
                {item.process_status === "failed"
                  ? " · processing failed"
                  : item.process_status !== "done"
                    ? ` · ${item.process_status}…`
                    : ""}
              </p>
              {/* Only show rerun on a clean-finished item with missing/
                  broken embedding. On "failed", the Retry button at the top
                  already covers re-running the whole pipeline. */}
              {item.process_status === "done" && (
                <KbRerunEmbeddingButton
                  itemId={id}
                  rerunning={retrying}
                  err={retryErr}
                  setRerunning={setRetrying}
                  setErr={setRetryErr}
                  onOptimisticEmbedding={() => {
                    setItem((it) =>
                      it ? { ...it, process_status: "embedding", process_error: null } : it,
                    );
                    setPollKey((k) => k + 1);
                  }}
                />
              )}
            </>
          ) : (
            <>
              <div className="stats-line">
                <span className="k">chunks</span>
                <span className="v">{stats.chunks_total}</span>
                <span className="k">·</span>
                <span className="v">{stats.embedding_dims ?? "—"}-d vectors</span>
                <span className="k">·</span>
                <span className="v">avg L2 norm {fmtNum(stats.avg_norm)}</span>
                <span className="k">·</span>
                <span className="v">
                  range [{fmtNum(stats.min_norm)}, {fmtNum(stats.max_norm)}]
                </span>
              </div>
              {((stats.embedding_dims != null &&
                stats.embedding_dims !== VOYAGE_EMBEDDING_DIM) ||
                stats.duplicate_indexes > 0) && (
                <>
                  <div className="stats-warn">
                    {stats.embedding_dims != null &&
                      stats.embedding_dims !== VOYAGE_EMBEDDING_DIM &&
                      `expected ${VOYAGE_EMBEDDING_DIM}-d vectors, got ${stats.embedding_dims}. `}
                    {stats.duplicate_indexes > 0 &&
                      `${stats.duplicate_indexes} duplicate chunk_index rows.`}
                  </div>
                  {item.process_status === "done" && (
                    <KbRerunEmbeddingButton
                      itemId={id}
                      rerunning={retrying}
                      err={retryErr}
                      setRerunning={setRetrying}
                      setErr={setRetryErr}
                      onOptimisticEmbedding={() => {
                        setItem((it) =>
                          it ? { ...it, process_status: "embedding", process_error: null } : it,
                        );
                        setPollKey((k) => k + 1);
                      }}
                    />
                  )}
                </>
              )}
              {sample && (
                <>
                  <button
                    type="button"
                    className="stats-toggle"
                    onClick={() => setShowVec((v) => !v)}
                  >
                    {showVec ? "hide vector sample" : "show vector sample"}
                  </button>
                  {showVec && (
                    <div className="vec-sample">
                      <div>chunk #{sample.chunk_index} · length {sample.embedding_length}</div>
                      <div>
                        head: [{sample.embedding_head.map((x) => x.toFixed(4)).join(", ")}]
                      </div>
                      <div>
                        tail: [{sample.embedding_tail.map((x) => x.toFixed(4)).join(", ")}]
                      </div>
                      <div style={{ marginTop: 8, opacity: 0.7 }}>
                        “{sample.chunk_text_preview}…”
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
          );
        })()}

        {isAdmin && (() => {
          // Hide the retrieval-debug inset whenever the chunks card is hidden
          // (i.e. the embedding looks healthy).
          const inFlight =
            item.process_status === "queued" ||
            item.process_status === "transcribing" ||
            item.process_status === "embedding" ||
            item.process_status === "analyzing";
          const embeddingHealthy =
            stats !== null &&
            stats.chunks_total > 0 &&
            (stats.embedding_dims == null ||
              stats.embedding_dims === VOYAGE_EMBEDDING_DIM) &&
            stats.duplicate_indexes === 0 &&
            item.process_status === "done";
          if (embeddingHealthy || inFlight) return null;
          return <KnowledgeUsageInset itemId={id} />;
        })()}

        <div className="media-pane">
          {media?.source_format === "video" && (
            <video src={media.url} controls preload="metadata" />
          )}
          {media?.source_format === "audio" && (
            <audio src={media.url} controls preload="metadata" />
          )}
          {media?.source_format === "text" && (
            <div className="text-doc">
              {textContent ?? "loading text…"}
            </div>
          )}
          {!media && <p className="loading-mono">media unavailable</p>}
        </div>

        {item.source_format !== "text" && (
        <div className="transcript-pane">
          <h2>Transcript</h2>
          {!transcript ? (
            <p className="loading-mono">
              {item.process_status === "done"
                ? "no transcript stored"
                : "transcript will appear once processing completes…"}
            </p>
          ) : transcript.segments && transcript.segments.length > 0 ? (
            <div>
              {transcript.segments.map((seg, i) => {
                const startMs = seg.start_ms ?? seg.start;
                const endMs = seg.end_ms ?? seg.end;
                return (
                <div className="seg-row" key={i}>
                  <div className="seg-ts">
                    {fmtTs(startMs)}
                    {endMs != null ? ` – ${fmtTs(endMs)}` : ""}
                  </div>
                  <div className="seg-text">
                    {seg.speaker && (
                      <span className="speaker">{seg.speaker}</span>
                    )}
                    {seg.text}
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <div className="transcript-fulltext">{transcript.full_text}</div>
          )}
        </div>
        )}
      </main>

      {confirmOpen && (
        <div
          className="confirm-overlay"
          onClick={() => !deleting && setConfirmOpen(false)}
        >
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h3>Delete this knowledge source?</h3>
            <p className="sub">
              This removes the file from storage and erases the transcript and
              embeddings. The coach will no longer learn from it. This cannot
              be undone.
            </p>
            <div className="target">{item.title}</div>
            <label htmlFor="confirm-input">Type DELETE to confirm</label>
            <input
              id="confirm-input"
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
            />
            {delErr && <p className="err-text">{delErr}</p>}
            <div className="acts">
              <button
                className="btn-cancel"
                type="button"
                disabled={deleting}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn-confirm-danger"
                type="button"
                disabled={confirmText !== "DELETE" || deleting}
                onClick={doDelete}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Knowledge-detail variant of the rerun button. Reuses the component's
// existing retry-state setters and the PATCH /api/knowledge/[id] start
// endpoint that the failed-status retry button already uses.
function KbRerunEmbeddingButton({
  itemId,
  rerunning,
  err,
  setRerunning,
  setErr,
  onOptimisticEmbedding,
}: {
  itemId: string;
  rerunning: boolean;
  err: string | null;
  setRerunning: (b: boolean) => void;
  setErr: (s: string | null) => void;
  onOptimisticEmbedding: () => void;
}) {
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        className="retry-btn-inline"
        onClick={async () => {
          setRerunning(true);
          setErr(null);
          try {
            const r = await fetch(`/api/knowledge/${itemId}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "reembed" }),
            });
            if (!r.ok) throw new Error((await r.text()) || `http ${r.status}`);
            // Flip local state immediately so the UI swaps to the in-flight
            // view, then restart polling to catch the server-side transitions.
            onOptimisticEmbedding();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setRerunning(false);
          }
        }}
        disabled={rerunning}
        style={{ alignSelf: "flex-start" }}
      >
        {rerunning ? "Rerunning…" : "Rerun embedding"}
      </button>
      {err && (
        <div className="stats-warn" style={{ opacity: 0.85 }}>
          rerun failed: {err}
        </div>
      )}
    </div>
  );
}

