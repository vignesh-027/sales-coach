"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import type { ProfileMenuUser } from "@/app/_components/profile-menu";

type CallType = "pre_sale" | "sales_followup" | "sales_closing";
type CallStatus =
  | "queued"
  | "transcribing"
  | "embedding"
  | "analyzing"
  | "done"
  | "failed";

interface CallRow {
  id: string;
  call_type: CallType;
  title: string;
  salesperson_name: string;
  client_name: string;
  process_status: CallStatus;
  process_error: string | null;
  created_at: string;
  recordings_count: number;
  duration_sec_total: number;
}

const TYPE_TAG: Record<CallType, string> = {
  pre_sale: "pre-sale",
  sales_followup: "sales-followup",
  sales_closing: "sales-closing",
};
const TYPE_FILTER_KEY: Record<CallType, string> = {
  pre_sale: "pre_sale",
  sales_followup: "sales_followup",
  sales_closing: "sales_closing",
};

const STATUS_TEXT: Record<CallStatus, string> = {
  queued: "queued…",
  transcribing: "transcribing…",
  embedding: "embedding…",
  analyzing: "analyzing…",
  done: "done",
  failed: "failed",
};

function fmtDate(iso: string): { d: string; t: string } {
  const dt = new Date(iso);
  const d = dt
    .toLocaleString("en-US", { month: "short", day: "numeric" })
    .toLowerCase();
  const t = dt
    .toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
  return { d, t };
}
function fmtDur(sec: number): string | null {
  if (!sec) return null;
  if (sec < 60) return `${sec}s`;
  return `${Math.round(sec / 60)} min`;
}

function ArrowRight() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="7,4 12,9 7,14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <span className="plus" aria-hidden>
      +
    </span>
  );
}

function CallCard({
  call,
  onDelete,
  onRetry,
  retrying,
  isAdmin,
}: {
  call: CallRow;
  onDelete: (c: CallRow) => void;
  onRetry: (c: CallRow) => void;
  retrying: boolean;
  isAdmin: boolean;
}) {
  const done = call.process_status === "done";
  const failed = call.process_status === "failed";
  const processing =
    !done && !failed && call.process_status !== "queued"
      ? call.process_status
      : null;
  const queued = call.process_status === "queued";
  const { d, t } = fmtDate(call.created_at);
  const dur = fmtDur(call.duration_sec_total);

  const content = (
    <div className="call-card">
      <div className="date">
        <span className="d">{d}</span>
        <span className="t">{t}</span>
      </div>
      <div className="ttl-row">
        <h3 className="ttl">{call.title}</h3>
        <span className="by">
          <em>{call.salesperson_name}</em> with {call.client_name}
          {call.recordings_count > 1
            ? ` · ${call.recordings_count} recordings`
            : ""}
        </span>
      </div>
      <div className="right">
        <div className="tags">
          <span className="tag">{TYPE_TAG[call.call_type]}</span>
        </div>
        {done && dur && <span className="dur">{dur}</span>}
        {(processing || queued) && (
          <span className="status-line">
            {STATUS_TEXT[call.process_status]}
          </span>
        )}
        {failed && (
          <>
            <span className="err-line" title={call.process_error ?? ""}>
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="6,1.5 11,10.5 1,10.5" />
                <line x1="6" y1="5" x2="6" y2="7.5" />
                <circle cx="6" cy="9" r="0.4" fill="currentColor" />
              </svg>
              {call.process_error
                ? call.process_error.replace(/^[a-z_]+ failed:\s*/i, "")
                : "Processing failed"}
            </span>
            <button
              className="retry-btn"
              type="button"
              disabled={retrying}
              aria-busy={retrying}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (retrying) return;
                onRetry(call);
              }}
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </>
        )}
      </div>
      {done && (
        <span className="go-arrow">
          <ArrowRight />
        </span>
      )}
      {isAdmin && (
        <button
          className="card-remove"
          type="button"
          aria-label="Remove call"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(call);
          }}
        >
          ×
        </button>
      )}
    </div>
  );

  const klass = done
    ? "card"
    : failed
      ? "card is-failed"
      : "card is-processing";
  return (
    <Link
      href={`/calls/${call.id}`}
      className={klass}
      data-type={TYPE_TAG[call.call_type]}
    >
      {content}
    </Link>
  );
}

function DeleteConfirm({
  call,
  onCancel,
  onConfirmed,
}: {
  call: CallRow;
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
      const res = await fetch(`/api/calls/${call.id}`, { method: "DELETE" });
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
        <h3>Delete this call?</h3>
        <p className="sub">
          This removes the recordings from storage and erases the transcripts,
          embeddings, and AI report. This cannot be undone.
        </p>
        <div className="target">{call.title}</div>
        <label htmlFor="confirm-input">Type DELETE to confirm</label>
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

const FILTERS: Array<{ key: "all" | CallType; label: string }> = [
  { key: "all", label: "All" },
  { key: "pre_sale", label: "Pre-sale" },
  { key: "sales_closing", label: "Sales-closing" },
  { key: "sales_followup", label: "Sales-followup" },
];

export default function CallsClient({
  user,
}: {
  user: ProfileMenuUser;
}) {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<CallRow | null>(null);
  const [filter, setFilter] = useState<"all" | CallType>("all");
  const [query, setQuery] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/calls", { cache: "no-store" });
      const json = (await res.json()) as { calls: CallRow[] };
      setCalls(json.calls ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => {
    const c = { all: calls.length, pre_sale: 0, sales_followup: 0, sales_closing: 0 } as Record<string, number>;
    for (const x of calls) c[x.call_type] = (c[x.call_type] ?? 0) + 1;
    return c;
  }, [calls]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return calls.filter((c) => {
      if (filter !== "all" && c.call_type !== filter) return false;
      if (!q) return true;
      const hay = [
        c.title,
        c.client_name,
        c.salesperson_name,
        TYPE_TAG[c.call_type],
        c.process_status,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [calls, filter, query]);

  const stats = useMemo(() => {
    const total = calls.length;
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const thisWeek = calls.filter(
      (c) => now - new Date(c.created_at).getTime() < weekMs,
    ).length;
    const done = calls.filter((c) => c.process_status === "done").length;
    const lastUpdate = calls[0]?.created_at ?? null;
    return { total, thisWeek, done, lastUpdate };
  }, [calls]);

  async function retry(c: CallRow) {
    // Guard against double-triggers: ignore repeat clicks while this call's
    // retry is already in flight. The button is also disabled in the UI, but
    // this protects against rapid clicks landing before the re-render.
    if (retryingId === c.id) return;
    setRetryingId(c.id);
    try {
      await fetch(`/api/calls/${c.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      await refresh();
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <>
      <main className="shell">
        <section className="page-head">
          <h1 className="top-title">
            Your call library<span className="dot">.</span>
          </h1>
          <div className="top-stats">
            <div className="stat">
              <span className="k">Indexed</span>
              <span className="v">
                {stats.total}
                <span className="unit">
                  {stats.total === 1 ? "call" : "calls"}
                </span>
              </span>
            </div>
            <div className="stat">
              <span className="k">This week</span>
              <span className="v">
                {stats.thisWeek}
                <span className="unit">new</span>
              </span>
            </div>
            <div className="stat">
              <span className="k">Done</span>
              <span className="v">
                {stats.done}
                <span className="unit">/ {stats.total}</span>
              </span>
            </div>
            <div className="stat">
              <span className="k">Last update</span>
              <span className="v" style={{ fontSize: 15 }}>
                {stats.lastUpdate
                  ? new Date(stats.lastUpdate)
                      .toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })
                      .toLowerCase()
                  : "—"}
              </span>
            </div>
          </div>
        </section>

        <section className="find" aria-label="Search and filter">
          <div className="find-head">
            <span className="label label--accent">Search &amp; filter</span>
            <span className="hint">
              press <kbd>⌘</kbd>
              <kbd>K</kbd> to focus
            </span>
          </div>

          <div className="search-wrap">
            <span className="icon-l">
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              >
                <circle cx="8" cy="8" r="5.5" />
                <path d="M12 12l4 4" strokeLinecap="round" />
              </svg>
            </span>
            <input
              ref={searchRef}
              className="search-input"
              placeholder="Search calls, clients, owners…"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="icon-r">
              <span className="n">{filtered.length}</span> match
              {filtered.length === 1 ? "" : "es"}
            </span>
          </div>

          <div className="filter-row">
            <span className="label">Type</span>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`chip${filter === f.key ? " active" : ""}`}
                type="button"
                onClick={() => setFilter(f.key)}
              >
                {f.label}{" "}
                <span className="count">
                  {f.key === "all" ? counts.all : counts[TYPE_FILTER_KEY[f.key]] ?? 0}
                </span>
              </button>
            ))}
            <div className="sort">
              <span className="label">Sort</span>
              <span className="v">newest first</span>
            </div>
          </div>
        </section>

        <div className="section-head">
          <h2 className="ttl">
            Recent calls <span className="accent">·</span>{" "}
            <span style={{ color: "var(--ink-2)", fontWeight: 400 }}>
              most recent first
            </span>
          </h2>
          <div className="right">
            <span>
              showing <b>{filtered.length}</b> of <b>{calls.length}</b>
            </span>
          </div>
        </div>

        {loading ? (
          <p className="loading-mono">loading…</p>
        ) : filtered.length === 0 ? (
          <div className="empty show">
            <h3>
              {calls.length === 0 ? "No calls yet." : "No calls match."}
            </h3>
            <p className="sub">
              {calls.length === 0
                ? "Upload a sales call to start coaching."
                : "Try a different search or filter."}
            </p>
            {calls.length === 0 && (
              <Link href="/calls/add" className="btn meta">
                <PlusIcon />
                Upload first call
              </Link>
            )}
          </div>
        ) : (
          <section className="list">
            {filtered.map((c) => (
              <CallCard
                key={c.id}
                call={c}
                onDelete={setPendingDelete}
                onRetry={retry}
                retrying={retryingId === c.id}
                isAdmin={user.isAdmin}
              />
            ))}
          </section>
        )}
      </main>
      {pendingDelete && (
        <DeleteConfirm
          call={pendingDelete}
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
