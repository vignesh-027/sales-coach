"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ProfileMenuUser } from "@/app/_components/profile-menu";

type Kind = "founder_video" | "reference_call" | "text_document";
type SourceFormat = "audio" | "video" | "text";
type ProcessStatus =
  | "queued"
  | "transcribing"
  | "embedding"
  | "done"
  | "failed";

interface KnowledgeItem {
  id: string;
  kind: Kind;
  title: string;
  description: string | null;
  source_format: SourceFormat;
  media_type: string;
  process_status: ProcessStatus;
  process_error: string | null;
  duration_sec: number | null;
  created_at: string;
}

interface SearchHit {
  knowledge_item_id: string;
  item_title: string;
  chunk_index: number;
  chunk_text: string;
  distance: number;
}

function SanityCheck() {
  const [queryText, setQueryText] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string>("");
  const [lastQueryDim, setLastQueryDim] = useState<number | null>(null);

  async function runQuery(e: React.FormEvent) {
    e.preventDefault();
    const q = queryText.trim();
    if (!q) return;
    setSearching(true);
    setSearchErr(null);
    setHits(null);
    try {
      const r = await fetch(`/api/knowledge/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, match_count: 5 }),
      });
      if (!r.ok) {
        const raw = await r.text();
        let msg = raw;
        try {
          const parsed = JSON.parse(raw) as { error?: string };
          if (parsed?.error) msg = parsed.error;
        } catch {}
        throw new Error(msg);
      }
      const j = (await r.json()) as {
        results: SearchHit[];
        query_dim?: number;
        result_count?: number;
      };
      console.debug("[sanity]", {
        query: q,
        query_dim: j.query_dim,
        result_count: j.result_count,
        got: j.results?.length ?? 0,
      });
      setLastQuery(q);
      setLastQueryDim(j.query_dim ?? null);
      setHits(j.results ?? []);
    } catch (err) {
      setSearchErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="sanity-card">
      <h3>Just Search</h3>
      <form className="sanity-form" onSubmit={runQuery}>
        <input
          type="text"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="Search for ....."
        />
        <button type="submit" disabled={searching || !queryText.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
        {(hits || searchErr || queryText) && (
          <button
            type="button"
            className="btn-clear"
            onClick={() => {
              setQueryText("");
              setHits(null);
              setSearchErr(null);
              setLastQuery("");
              setLastQueryDim(null);
            }}
          >
            Clear
          </button>
        )}
      </form>
      {searchErr && <div className="stats-warn">{searchErr}</div>}
      {hits && hits.length === 0 && (
        <p className="loading-mono">
          0 results for “{lastQuery}” · query embedded to{" "}
          {lastQueryDim ?? "?"}-d vectors
        </p>
      )}
      {hits && hits.length > 0 && (
        <div className="sanity-results">
          <p className="loading-mono" style={{ marginBottom: 8 }}>
            top {hits.length} for “{lastQuery}”
          </p>
          {hits.map((h, i) => (
            <Link
              key={i}
              href={`/knowledge/${h.knowledge_item_id}`}
              className="sanity-hit"
              style={{ textDecoration: "none" }}
            >
              <span className="dist">{h.distance.toFixed(3)}</span>
              <div>
                <div className="hit-title">{h.item_title}</div>
                <div className="hit-prev">
                  {h.chunk_text.replace(/\s+/g, " ").slice(0, 200)}…
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtAdded(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleString("en-US", { month: "short", day: "numeric" })
    .toLowerCase();
}
function fmtDur(sec: number | null): string | null {
  if (!sec) return null;
  if (sec < 60) return `${sec}s`;
  return `${Math.round(sec / 60)} min`;
}

function FormatBadge({ format }: { format: SourceFormat }) {
  if (format === "video") {
    return (
      <span className="format-badge" title="video">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="1" y="2.5" width="8" height="7" rx="1" />
          <path d="M9 5l2-1.5v5L9 7z" fill="currentColor" />
        </svg>
        video
      </span>
    );
  }
  if (format === "audio") {
    return (
      <span className="format-badge" title="audio">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
          <path d="M2 7v-2M4 8v-4M6 9v-6M8 8v-4M10 7v-2" />
        </svg>
        audio
      </span>
    );
  }
  return (
    <span className="format-badge" title="text">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <path d="M3 3h6M3 6h6M3 9h4" />
      </svg>
      text
    </span>
  );
}

function StatusBlock({
  status,
  error,
}: {
  status: ProcessStatus;
  error: string | null;
}) {
  if (status === "failed") {
    return (
      <div className="status-block">
        <svg
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="22"
          height="22"
        >
          <polygon points="11,3 20,18 2,18" />
          <line x1="11" y1="9" x2="11" y2="13" />
          <circle cx="11" cy="15.4" r="0.6" fill="currentColor" />
        </svg>
        <span className="stext">processing failed</span>
        {error && (
          <span className="ssub" style={{ maxWidth: 240 }}>
            {error.length > 80 ? error.slice(0, 80) + "…" : error}
          </span>
        )}
      </div>
    );
  }
  const label =
    status === "transcribing"
      ? "transcribing…"
      : status === "embedding"
        ? "embedding…"
        : "queued…";
  const sub = status === "embedding" ? "step 2 of 2" : "step 1 of 2";
  return (
    <div className="status-block">
      <div className="status-spinner" aria-hidden="true" />
      <span className="stext is-pulse">{label}</span>
      <span className="ssub">{sub}</span>
    </div>
  );
}

function StepRow({ status }: { status: ProcessStatus }) {
  const first =
    status === "transcribing"
      ? "active"
      : status === "embedding" || status === "done"
        ? "done"
        : "";
  const second = status === "embedding" ? "active" : status === "done" ? "done" : "";
  return (
    <div className="step-row" aria-hidden="true">
      <span>transcribe</span>
      <span className={`seg ${first}`} />
      <span className={`seg ${second}`} />
      <span>embed</span>
    </div>
  );
}

function VideoCard({
  item,
  onDelete,
  onRetry,
  isAdmin,
}: {
  item: KnowledgeItem;
  onDelete: (it: KnowledgeItem) => void;
  onRetry: (it: KnowledgeItem) => void;
  isAdmin: boolean;
}) {
  const isProcessing =
    item.process_status !== "done" && item.process_status !== "failed";
  const isStatus = item.process_status !== "done";
  const failed = item.process_status === "failed";
  const queued = item.process_status === "queued";

  const inner = (
    <>
      <div className="poster">
        {!isStatus && (
          <>
            <span className="play-tri" aria-hidden="true">
              <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="0.75">
                <circle cx="14" cy="14" r="13" />
                <polygon points="11,8 11,20 21,14" fill="currentColor" stroke="none" />
              </svg>
            </span>
            {isAdmin && (
              <button
                className="remove-pill"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(item);
                }}
              >
                Remove
              </button>
            )}
          </>
        )}
        {isStatus && (
          <>
            <StatusBlock status={item.process_status} error={item.process_error} />
            {!failed && <StepRow status={item.process_status} />}
            {(failed || queued) && (
              <button
                className="retry-btn-inline"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRetry(item);
                }}
                style={{ position: "absolute", top: 12, right: 12 }}
              >
                Retry
              </button>
            )}
          </>
        )}
      </div>
      <div className="body">
        <div className="vtitle">{item.title}</div>
        <div className="meta-row">
          <FormatBadge format={item.source_format} />
          {fmtDur(item.duration_sec) && <>{fmtDur(item.duration_sec)} · </>}
          added {fmtAdded(item.created_at)}
        </div>
      </div>
    </>
  );

  return (
    <Link
      href={`/knowledge/${item.id}`}
      className={`vcard ${isStatus ? "is-status" : ""} ${failed ? "is-failed" : ""}`}
    >
      {inner}
    </Link>
  );
}

function AudioRow({
  item,
  onDelete,
  onRetry,
  isAdmin,
}: {
  item: KnowledgeItem;
  onDelete: (it: KnowledgeItem) => void;
  onRetry: (it: KnowledgeItem) => void;
  isAdmin: boolean;
}) {
  const done = item.process_status === "done";
  const failed = item.process_status === "failed";
  const stuck =
    item.process_status === "queued" || item.process_status === "failed";
  const content = (
    <>
      <button
        className="ap-play"
        type="button"
        aria-label="Play"
        onClick={(e) => {
          if (!done) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <polygon points="2.5,1 2.5,9 9,5" fill="#fff" />
        </svg>
      </button>
      <div className="ap-info">
        <h3 className="ap-title">{item.title}</h3>
        <div className="ap-meta">
          <FormatBadge format={item.source_format} />
          {fmtDur(item.duration_sec) ?? "—"} · added {fmtAdded(item.created_at)}
        </div>
      </div>
      {!done && (
        <span className="status-inline">
          {failed ? "failed" : item.process_status + "…"}
        </span>
      )}
      {stuck && (
        <button
          className="retry-btn-inline"
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRetry(item);
          }}
        >
          Retry
        </button>
      )}
      {isAdmin && (
        <button
          className="remove-pill-inline"
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(item);
          }}
        >
          Remove
        </button>
      )}
    </>
  );
  return (
    <Link href={`/knowledge/${item.id}`} className="aplayer">
      {content}
    </Link>
  );
}

function TextRow({
  item,
  onDelete,
  onRetry,
  isAdmin,
}: {
  item: KnowledgeItem;
  onDelete: (it: KnowledgeItem) => void;
  onRetry: (it: KnowledgeItem) => void;
  isAdmin: boolean;
}) {
  const done = item.process_status === "done";
  const failed = item.process_status === "failed";
  const stuck =
    item.process_status === "queued" || item.process_status === "failed";
  const content = (
    <>
      <div className="tdoc-ic">
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <path d="M4 2.5h7l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z" />
          <polyline points="10.5,2.5 10.5,5.5 13.5,5.5" />
          <path d="M5.5 9h7M5.5 11.5h7M5.5 14h4" />
        </svg>
      </div>
      <div className="ap-info">
        <h3 className="ap-title">{item.title}</h3>
        <div className="ap-meta">
          <FormatBadge format="text" />
          .{item.media_type} · added {fmtAdded(item.created_at)}
          {!done && (
            <>
              {" · "}
              <span style={{ color: "var(--accent)" }}>
                {failed ? "failed" : item.process_status + "…"}
              </span>
            </>
          )}
        </div>
      </div>
      {stuck && (
        <button
          className="retry-btn-inline"
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRetry(item);
          }}
        >
          Retry
        </button>
      )}
      {isAdmin && (
        <button
          className="remove-pill-inline"
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(item);
          }}
        >
          Remove
        </button>
      )}
    </>
  );
  return (
    <Link href={`/knowledge/${item.id}`} className="tcard">
      {content}
    </Link>
  );
}

function DeleteConfirm({
  item,
  onCancel,
  onConfirmed,
}: {
  item: KnowledgeItem;
  onCancel: () => void;
  onConfirmed: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const enabled = text === "DELETE" && !busy;

  async function doDelete() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/knowledge/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      onConfirmed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <h3>Delete this knowledge source?</h3>
        <p className="sub">
          This removes the file from storage and erases the transcript and
          embeddings. The coach will no longer learn from it. This cannot be
          undone.
        </p>
        <div className="target">{item.title}</div>
        <label htmlFor="confirm-input">
          Type DELETE to confirm
        </label>
        <input
          id="confirm-input"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="DELETE"
        />
        {err && <p className="err-text">{err}</p>}
        <div className="acts">
          <button className="btn-cancel" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-confirm-danger"
            type="button"
            disabled={!enabled}
            onClick={doDelete}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgeClient({
  user,
}: {
  user: ProfileMenuUser;
}) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeItem | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/knowledge", { cache: "no-store" });
      const json = (await res.json()) as { items: KnowledgeItem[] };
      setItems(json.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const founder = useMemo(
    () => items.filter((i) => i.kind === "founder_video"),
    [items],
  );
  const reference = useMemo(
    () => items.filter((i) => i.kind === "reference_call"),
    [items],
  );
  const textDocs = useMemo(
    () => items.filter((i) => i.kind === "text_document"),
    [items],
  );

  const [retryErr, setRetryErr] = useState<string | null>(null);
  async function retry(item: KnowledgeItem) {
    setRetryErr(null);
    setItems((cur) =>
      cur.map((it) =>
        it.id === item.id
          ? { ...it, process_status: "queued", process_error: null }
          : it,
      ),
    );
    try {
      const r = await fetch(`/api/knowledge/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (!r.ok) {
        const raw = await r.text();
        let msg = raw;
        try {
          const parsed = JSON.parse(raw) as { error?: string };
          if (parsed?.error) msg = parsed.error;
        } catch {}
        throw new Error(msg);
      }
    } catch (e) {
      setRetryErr(
        `retry failed for “${item.title}”: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    } finally {
      void refresh();
    }
  }

  return (
    <>
      {retryErr && (
        <div
          className="stats-warn"
          style={{ margin: "12px 24px", maxWidth: 960 }}
        >
          {retryErr}
        </div>
      )}
      <main className="shell">
        <section className="hero">
          <span className="label eyebrow">Knowledge</span>
          <h1>
            What the coach knows<span className="dot">.</span>
          </h1>
          <p className="sub">
            Founder videos, reference sales calls, and text playbooks teach the
            coach the business. Everything below is transcribed, embedded, and
            available for retrieval — no scoring.
          </p>
        </section>

        <section aria-labelledby="sec-sanity">
          <div className="sec-head">
            <div className="left">
              <span id="sec-sanity" className="label">
                00 · just search
              </span>
              <span className="tier-note">retrieval across all sources</span>
            </div>
          </div>
          <SanityCheck />
        </section>

        {/* <div className="section-spacer-top" /> */}
        {/* <div className="hairline" /> */}
        {/* <div className="section-spacer-bot" /> */}

        <section aria-labelledby="sec-videos">
          <div className="sec-head">
            <div className="left">
              <span id="sec-videos" className="label">
                01 · founder &amp; business videos
              </span>
              <span className="count">
                {founder.length} {founder.length === 1 ? "video" : "videos"}
              </span>
              <span className="tier-note">transcribed · no scoring</span>
            </div>
            <Link
              href="/knowledge/add?kind=founder_video"
              className="btn-add"
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2v6" />
                <path d="M3 5l3-3 3 3" />
                <path d="M2 10h8" />
              </svg>
              Add video
            </Link>
          </div>
          {loading ? (
            <p className="loading-mono">loading…</p>
          ) : founder.length === 0 ? (
            <div className="empty-block">
              <h3>No founder videos yet</h3>
              <p>
                Upload a founder or product walkthrough to teach the coach the
                business.
              </p>
            </div>
          ) : (
            <div className="video-grid">
              {founder.map((it) => (
                <VideoCard
                  key={it.id}
                  item={it}
                  onDelete={setPendingDelete}
                  onRetry={retry}
                  isAdmin={user.isAdmin}
                />
              ))}
            </div>
          )}
        </section>

        <div className="section-spacer-top" />
        <div className="hairline" />
        <div className="section-spacer-bot" />

        <section aria-labelledby="sec-standard">
          <div className="sec-head">
            <div className="left">
              <span id="sec-standard" className="label">
                02 · standard sales calls
              </span>
              <span className="count">
                {reference.length} {reference.length === 1 ? "call" : "calls"}
              </span>
              <span className="tier-note">transcribed · no scoring</span>
            </div>
            <Link
              href="/knowledge/add?kind=reference_call"
              className="btn-add"
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2v6" />
                <path d="M3 5l3-3 3 3" />
                <path d="M2 10h8" />
              </svg>
              Add call
            </Link>
          </div>
          {loading ? (
            <p className="loading-mono">loading…</p>
          ) : reference.length === 0 ? (
            <div className="empty-block">
              <h3>No reference calls yet</h3>
              <p>
                Upload exemplar discovery, demo, or closing calls so the coach
                knows the shape of the work.
              </p>
            </div>
          ) : (
            <div className="audio-grid">
              {reference.map((it) => (
                <AudioRow
                  key={it.id}
                  item={it}
                  onDelete={setPendingDelete}
                  onRetry={retry}
                  isAdmin={user.isAdmin}
                />
              ))}
            </div>
          )}
        </section>

        <div className="section-spacer-top" />
        <div className="hairline" />
        <div className="section-spacer-bot" />

        <section aria-labelledby="sec-text">
          <div className="sec-head">
            <div className="left">
              <span id="sec-text" className="label">
                03 · text playbooks &amp; docs
              </span>
              <span className="count">
                {textDocs.length} {textDocs.length === 1 ? "doc" : "docs"}
              </span>
              <span className="tier-note">embedded · no scoring</span>
            </div>
            <Link
              href="/knowledge/add?kind=text_document"
              className="btn-add"
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2v6" />
                <path d="M3 5l3-3 3 3" />
                <path d="M2 10h8" />
              </svg>
              Add doc
            </Link>
          </div>
          {loading ? (
            <p className="loading-mono">loading…</p>
          ) : textDocs.length === 0 ? (
            <div className="empty-block">
              <h3>No text documents yet</h3>
              <p>
                Drop in playbooks, FAQs, battle-cards, or any .txt/.md/.docx
                file you want the coach to know.
              </p>
            </div>
          ) : (
            <div className="text-grid">
              {textDocs.map((it) => (
                <TextRow
                  key={it.id}
                  item={it}
                  onDelete={setPendingDelete}
                  onRetry={retry}
                  isAdmin={user.isAdmin}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {pendingDelete && (
        <DeleteConfirm
          item={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirmed={() => {
            setPendingDelete(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}
