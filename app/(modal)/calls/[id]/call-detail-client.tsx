"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { VOYAGE_EMBEDDING_DIM } from "@/services/voyage/client";
import { CallRetrievalInset } from "./retrieval-inset";

interface ChunkStats {
  chunks_total: number;
  chunks_with_embedding: number;
  embedding_dims: number | null;
  min_norm: number | null;
  max_norm: number | null;
  avg_norm: number | null;
  duplicate_indexes: number;
}

interface ChunkSample {
  chunk_index: number;
  chunk_text_preview: string;
  embedding_head: number[];
  embedding_tail: number[];
  embedding_length: number;
}

function fmtStatNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

type CallStatus =
  | "queued"
  | "transcribing"
  | "embedding"
  | "analyzing"
  | "done"
  | "failed";

interface Segment {
  speaker?: string;
  start_ms: number;
  end_ms: number;
  text: string;
}

interface RecordingDTO {
  id: string;
  recording_index: number;
  media_type: string;
  source_format: "audio" | "video";
  duration_sec: number | null;
  transcribe_status: string;
  transcribe_error: string | null;
  media_url: string | null;
  transcript: { full_text: string; segments: Segment[] } | null;
}

// Dynamic top-5 ranking: keys are short founder-voice phrases naming what
// THIS call attempted (e.g. "anchoring to her own words", "predictive
// intelligence"), values are 1–5. Keys differ across calls by design.
type RubricScore = Record<string, number>;

interface PlaybookCitation {
  title: string;
  source_type: "founder_video" | "reference_call" | "text_document";
  start_ts_ms: number;
  end_ts_ms: number;
}

interface KeyMoment {
  recording_index: number;
  start_ts_ms: number;
  end_ts_ms: number;
  label: string;
  quote: string;
  what_happened: string;
  why_it_matters: string;
}

interface Rewrite {
  recording_index: number;
  start_ts_ms: number;
  client_said?: string;
  original: string;
  rewrite: string;
  rationale: string;
  playbook_source: PlaybookCitation;
}

interface CallReport {
  summary: {
    tldr: string;
    outcome:
      | "won"
      | "lost"
      | "follow_up_needed"
      | "stalled"
      | "unclear";
    deal_health: "strong" | "mixed" | "weak";
    rep_performance_rubric: RubricScore;
    duration_minutes_total: number;
  };
  key_moments: KeyMoment[];
  rewrites: Rewrite[];
  patterns: Array<{
    name: string;
    description: string;
    evidence: Array<{ recording_index: number; start_ts_ms: number }>;
    playbook_alignment: string;
  }>;
}

interface CallDTO {
  call: {
    id: string;
    call_type: string;
    title: string;
    salesperson_name: string;
    client_name: string;
    process_status: CallStatus;
    process_error: string | null;
    created_at: string;
  };
  recordings: RecordingDTO[];
  report: {
    model: string;
    prompt_version: number;
    report: CallReport;
    input_tokens: number | null;
    output_tokens: number | null;
    created_at: string;
  } | null;
}

function fmtTs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}
function fmtAdded(iso: string): string {
  return new Date(iso)
    .toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toLowerCase();
}
function firstSentence(s: string, maxLen = 160): string {
  if (!s) return "";
  const m = s.match(/^[^.!?]+[.!?]/);
  const out = m ? m[0] : s;
  return out.length > maxLen ? out.slice(0, maxLen).trim() + "…" : out.trim();
}

const NAV_SECTIONS = [
  { id: "summary", num: "01", label: "Summary" },
  { id: "timeline", num: "02", label: "Timeline" },
  { id: "rewrites", num: "03", label: "Rewrites" },
  { id: "patterns", num: "04", label: "Patterns" },
];

const PLAYING_LEAD_MS = 250;
const PLAYING_TRAIL_MS = 8000;

export default function CallDetailClient({
  id,
  isAdmin = false,
}: {
  id: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  // ?from=observability is appended by the Recent Analyses link so the Close
  // button + delete-redirect return there instead of /calls. New tab / direct
  // URL / bookmark — no param — falls back to /calls.
  const searchParams = useSearchParams();
  const backHref =
    searchParams?.get("from") === "observability"
      ? "/admin/observability"
      : "/calls";
  const [data, setData] = useState<CallDTO | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerView, setDrawerView] = useState<"list" | "player">("list");
  const [selectedRecordingIndex, setSelectedRecordingIndex] = useState<
    number | null
  >(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [playerDurationMs, setPlayerDurationMs] = useState<number | null>(null);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerSpeed, setPlayerSpeed] = useState(1);
  const [activeSection, setActiveSection] = useState<string>("summary");

  const playerElRef = useRef<HTMLMediaElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const lastCommitMsRef = useRef(0);
  const mediaUrlCache = useRef<Map<string, string>>(new Map());

  // ---- admin-only embedding validation stats ----
  const [stats, setStats] = useState<ChunkStats | null>(null);
  const [statsSample, setStatsSample] = useState<ChunkSample | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [showVec, setShowVec] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/calls/${id}/chunks`, { cache: "no-store" });
        if (!r.ok) {
          const t = await r.text();
          if (!cancelled) setStatsErr(t || `http ${r.status}`);
          return;
        }
        const j = (await r.json()) as {
          stats: ChunkStats | null;
          sample: ChunkSample | null;
        };
        if (cancelled) return;
        setStats(j.stats);
        setStatsSample(j.sample);
        setStatsErr(null);
      } catch (e) {
        if (!cancelled)
          setStatsErr(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    // Poll while processing; stop once the call is done so we don't spam.
    const timer = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, isAdmin]);

  // ---- data fetch / poll (stops once done) ----
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load() {
      const r = await fetch(`/api/calls/${id}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as CallDTO;
      if (cancelled) return;

      // Cache media URLs the first time we see them so later refetches
      // don't change the <audio src> mid-playback.
      for (const rec of j.recordings) {
        if (rec.media_url && !mediaUrlCache.current.has(rec.id)) {
          mediaUrlCache.current.set(rec.id, rec.media_url);
        }
      }

      setData(j);
      setSelectedRecordingIndex((prev) =>
        prev != null ? prev : (j.recordings[0]?.recording_index ?? null),
      );

      if (j.call.process_status === "done" && timer) {
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
  }, [id]);

  const status = data?.call.process_status;
  const showReport = status === "done" && data?.report;
  const showSkeleton =
    status === "transcribing" ||
    status === "embedding" ||
    status === "analyzing" ||
    status === "queued";

  const selectedRecording = useMemo(() => {
    if (!data || selectedRecordingIndex == null) return null;
    return (
      data.recordings.find(
        (r) => r.recording_index === selectedRecordingIndex,
      ) ?? null
    );
  }, [data, selectedRecordingIndex]);

  const stableMediaUrl = selectedRecording
    ? (mediaUrlCache.current.get(selectedRecording.id) ??
        selectedRecording.media_url)
    : null;

  // ---- IntersectionObserver for side nav active state ----
  useEffect(() => {
    if (!showReport) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -50% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    NAV_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [showReport]);

  // ---- player attach ----
  const attachPlayer = useCallback((el: HTMLMediaElement | null) => {
    playerElRef.current = el;
    if (!el) {
      setPlayerDurationMs(null);
      setPlayerPlaying(false);
      return;
    }

    const commit = () => {
      const now = el.currentTime * 1000;
      if (Math.abs(now - lastCommitMsRef.current) >= 150) {
        lastCommitMsRef.current = now;
        setCurrentTimeMs(now);
      }
    };
    const onTime = () => requestAnimationFrame(commit);
    const onLoaded = () => {
      if (Number.isFinite(el.duration)) {
        setPlayerDurationMs(el.duration * 1000);
      }
      const pending = pendingSeekRef.current;
      if (pending != null) {
        pendingSeekRef.current = null;
        try {
          el.currentTime = pending / 1000;
        } catch {
          /* noop */
        }
        void el.play().catch(() => undefined);
      }
    };
    const onPlay = () => setPlayerPlaying(true);
    const onPause = () => setPlayerPlaying(false);

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    if (el.readyState >= 1) onLoaded();
  }, []);

  // ---- open drawer / seek ----
  const openDrawerForListen = useCallback(() => {
    if (!data) return;
    setDrawerOpen(true);
    if (data.recordings.length === 1) {
      setSelectedRecordingIndex(data.recordings[0].recording_index);
      setDrawerView("player");
    } else {
      setDrawerView("list");
    }
  }, [data]);

  const selectFileInDrawer = useCallback((recordingIndex: number) => {
    setSelectedRecordingIndex(recordingIndex);
    setDrawerView("player");
  }, []);

  const backToFileList = useCallback(() => {
    setDrawerView("list");
  }, []);

  const seekTo = useCallback(
    (recordingIndex: number, ms: number) => {
      // If we're already on this recording and the player is mounted, seek now.
      if (
        selectedRecordingIndex === recordingIndex &&
        drawerOpen &&
        drawerView === "player" &&
        playerElRef.current
      ) {
        const el = playerElRef.current;
        try {
          el.currentTime = ms / 1000;
        } catch {
          /* noop */
        }
        void el.play().catch(() => undefined);
        return;
      }
      // Otherwise queue the seek and open the drawer at that recording.
      pendingSeekRef.current = ms;
      setSelectedRecordingIndex(recordingIndex);
      setDrawerView("player");
      setDrawerOpen(true);
    },
    [selectedRecordingIndex, drawerOpen, drawerView],
  );

  const isMomentPlaying = useCallback(
    (recordingIndex: number, startMs: number) => {
      if (!drawerOpen || drawerView !== "player") return false;
      if (recordingIndex !== selectedRecordingIndex) return false;
      return (
        currentTimeMs >= startMs - PLAYING_LEAD_MS &&
        currentTimeMs <= startMs + PLAYING_TRAIL_MS
      );
    },
    [drawerOpen, drawerView, selectedRecordingIndex, currentTimeMs],
  );

  // ---- transport actions ----
  const togglePlay = useCallback(() => {
    const el = playerElRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const cycleSpeed = useCallback(() => {
    const speeds = [1, 1.25, 1.5, 1.75, 2, 0.75];
    const idx = speeds.indexOf(playerSpeed);
    const next = speeds[(idx + 1) % speeds.length];
    setPlayerSpeed(next);
    if (playerElRef.current) playerElRef.current.playbackRate = next;
  }, [playerSpeed]);

  const handleScrubClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = playerElRef.current;
      if (!el || !playerDurationMs) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.min(
        1,
        Math.max(0, (e.clientX - rect.left) / rect.width),
      );
      el.currentTime = (pct * playerDurationMs) / 1000;
    },
    [playerDurationMs],
  );

  async function doDelete() {
    setDeleting(true);
    setDelErr(null);
    try {
      const r = await fetch(`/api/calls/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      router.push(backHref);
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  async function retry() {
    await fetch(`/api/calls/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
  }

  if (!data) {
    return (
      <div className="modal-shell">
        <header className="top-bar">
          <Link href={backHref} className="back" aria-label="Back">
            <span className="ico">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="3" x2="11" y2="11" />
                <line x1="11" y1="3" x2="3" y2="11" />
              </svg>
            </span>
            <span className="lbl">Close</span>
          </Link>
          <span className="modal-title">Call detail</span>
          <span />
        </header>
        <div className="cd-grid">
          <aside className="sidebar" />
          <main className="content">
            <p className="loading-mono">loading…</p>
          </main>
        </div>
      </div>
    );
  }

  const c = data.call;
  const report = data.report?.report;
  const momentsForSelected =
    report && selectedRecordingIndex != null
      ? (report.key_moments ?? []).filter(
          (m) => m.recording_index === selectedRecordingIndex,
        )
      : [];
  const durationMsForMarkers =
    playerDurationMs ??
    (selectedRecording?.duration_sec != null
      ? selectedRecording.duration_sec * 1000
      : null);

  return (
    <div className="modal-shell">
      <header className="top-bar">
        <Link href={backHref} className="back" aria-label="Back">
          <span className="ico">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="3" x2="11" y2="11" />
              <line x1="11" y1="3" x2="3" y2="11" />
            </svg>
          </span>
          <span className="lbl">Close</span>
        </Link>
        <span className="modal-title">Call detail</span>
        <span />
      </header>

      <div className={`cd-grid${drawerOpen ? " drawer-open" : ""}`}>
      <SideNav
        active={activeSection}
        call={c}
        showSections={!!showReport}
      />

      <main className="content">
        <header className="call-hero">
          <span className="kicker">
            {c.call_type.replace(/_/g, " · ")}
            {status ? ` · ${status}` : ""}
          </span>
          <h1>{c.title}</h1>
          <p className="meta-line">
            <span>rep {c.salesperson_name}</span>
            <span> · </span>
            <span>client {c.client_name}</span>
            <span> · </span>
            <span>added {fmtAdded(c.created_at)}</span>
            {isAdmin && (
              <button
                type="button"
                className="delete-link"
                onClick={() => setConfirmOpen(true)}
              >
                Delete
              </button>
            )}
          </p>
          <button
            type="button"
            className="listen-btn"
            onClick={openDrawerForListen}
            disabled={data.recordings.length === 0}
          >
            <span className="tri">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <polygon points="2.5,1 2.5,9 9,5" fill="currentColor" />
              </svg>
            </span>
            Listen to call
          </button>
        </header>

        {isAdmin && (
          <div className="stats-card" style={{ marginTop: 16 }}>
            {statsErr ? (
              <div className="stats-warn">stats unavailable: {statsErr}</div>
            ) : !stats ? (
              <p className="loading-mono">loading embedding stats…</p>
            ) : stats.chunks_total === 0 ? (
              <p className="loading-mono">
                no embedding chunks yet
                {status === "failed"
                  ? " · processing failed"
                  : status && status !== "done"
                    ? ` · ${status}…`
                    : ""}
              </p>
            ) : (
              <>
                <div className="stats-line">
                  <span className="k">chunks</span>
                  <span className="v">{stats.chunks_total}</span>
                  <span className="k">·</span>
                  <span className="v">
                    {stats.embedding_dims ?? "—"}-d vectors
                  </span>
                  <span className="k">·</span>
                  <span className="v">
                    avg L2 norm {fmtStatNum(stats.avg_norm)}
                  </span>
                  <span className="k">·</span>
                  <span className="v">
                    range [{fmtStatNum(stats.min_norm)},{" "}
                    {fmtStatNum(stats.max_norm)}]
                  </span>
                </div>
                {((stats.embedding_dims != null &&
                  stats.embedding_dims !== VOYAGE_EMBEDDING_DIM) ||
                  stats.duplicate_indexes > 0) && (
                  <div className="stats-warn">
                    {stats.embedding_dims != null &&
                      stats.embedding_dims !== VOYAGE_EMBEDDING_DIM &&
                      `expected ${VOYAGE_EMBEDDING_DIM}-d vectors, got ${stats.embedding_dims}. `}
                    {stats.duplicate_indexes > 0 &&
                      `${stats.duplicate_indexes} duplicate chunk_index rows.`}
                  </div>
                )}
                {statsSample && (
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
                        <div>
                          chunk #{statsSample.chunk_index} · length{" "}
                          {statsSample.embedding_length}
                        </div>
                        <div>
                          head: [
                          {statsSample.embedding_head
                            .map((x) => x.toFixed(4))
                            .join(", ")}
                          ]
                        </div>
                        <div>
                          tail: [
                          {statsSample.embedding_tail
                            .map((x) => x.toFixed(4))
                            .join(", ")}
                          ]
                        </div>
                        <div style={{ marginTop: 8, opacity: 0.7 }}>
                          “{statsSample.chunk_text_preview}…”
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {isAdmin && <CallRetrievalInset callId={id} />}

        {status === "failed" && (
          <div className="report-card" style={{ marginTop: 24 }}>
            <p className="card-label">processing failed</p>
            <p style={{ color: "var(--ink-1)", margin: "0 0 12px" }}>
              {c.process_error ?? "Unknown error"}
            </p>
            <button
              type="button"
              className="retry-btn-inline"
              onClick={retry}
            >
              Retry
            </button>
          </div>
        )}

        {showSkeleton && status && (
          <ProgressStepper status={status} recordings={data.recordings} />
        )}

        {showReport && report && (
          <>
            <SummarySection report={report} />
            <TimelineSection
              report={report}
              onSeek={seekTo}
              isPlaying={isMomentPlaying}
            />
            <RewritesSection
              report={report}
              onSeek={seekTo}
              isPlaying={isMomentPlaying}
            />
            <PatternsSection report={report} onSeek={seekTo} />
          </>
        )}
      </main>

      {drawerOpen && (
      <aside className="rc is-open">
        {drawerView === "list" && (
          <div className="rc-list-wrap">
            <div className="rc-list-head">
              <span className="rc-label">recordings</span>
              <button
                type="button"
                className="rc-close"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="rc-files">
              {data.recordings.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="rc-file"
                  onClick={() => selectFileInDrawer(r.recording_index)}
                >
                  <span className="rc-file-num">
                    rec {String(r.recording_index).padStart(2, "0")}
                  </span>
                  <span className="rc-file-meta">
                    {r.source_format}
                    {r.duration_sec
                      ? ` · ${Math.round(r.duration_sec / 60)} min`
                      : ""}
                    {r.transcribe_status !== "done"
                      ? ` · ${r.transcribe_status}`
                      : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {drawerView === "player" &&
          selectedRecording &&
          stableMediaUrl && (
            <div className="rc-player">
              <div className="rc-player-head">
                <div className="rc-title-block">
                  <h3 className="rc-title">
                    recording{" "}
                    {String(selectedRecording.recording_index).padStart(2, "0")}
                  </h3>
                  <p className="rc-sub">
                    {selectedRecording.source_format}
                    {selectedRecording.duration_sec
                      ? ` · ${Math.round(selectedRecording.duration_sec / 60)} min`
                      : ""}
                    {" · "}
                    {selectedRecording.transcribe_status}
                  </p>
                </div>
                {data.recordings.length > 1 && (
                  <button
                    type="button"
                    className="rc-back"
                    onClick={backToFileList}
                  >
                    ← All files
                  </button>
                )}
                <button
                  type="button"
                  className="rc-close"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {selectedRecording.source_format === "video" ? (
                <video
                  key={selectedRecording.id}
                  src={stableMediaUrl}
                  ref={attachPlayer}
                  className="rc-video"
                  playsInline
                />
              ) : (
                <audio
                  key={selectedRecording.id}
                  src={stableMediaUrl}
                  ref={attachPlayer}
                  style={{ display: "none" }}
                />
              )}

              <div className="tp">
                <button
                  type="button"
                  className="tp-play"
                  onClick={togglePlay}
                  aria-label={playerPlaying ? "Pause" : "Play"}
                >
                  {playerPlaying ? (
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <rect x="2" y="1" width="2.2" height="8" fill="#fff" />
                      <rect x="5.8" y="1" width="2.2" height="8" fill="#fff" />
                    </svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <polygon points="2.5,1 2.5,9 9,5" fill="#fff" />
                    </svg>
                  )}
                </button>
                <span className="tp-time">
                  <span className="now">{fmtTs(currentTimeMs)}</span>
                  <span className="sep"> / </span>
                  <span className="tot">
                    {fmtTs(playerDurationMs ?? 0)}
                  </span>
                </span>
                <button
                  type="button"
                  className="tp-speed"
                  onClick={cycleSpeed}
                >
                  {playerSpeed.toFixed(playerSpeed % 1 === 0 ? 1 : 2)}×
                </button>
              </div>

              <Scrub
                durationMs={durationMsForMarkers}
                currentMs={currentTimeMs}
                moments={momentsForSelected}
                onScrub={handleScrubClick}
                onMarkerClick={(ms) => {
                  if (selectedRecording) {
                    seekTo(selectedRecording.recording_index, ms);
                  }
                }}
              />

              <div className="tx">
                {selectedRecording.transcript ? (
                  selectedRecording.transcript.segments.map((s, i) => (
                    <div key={i} className="tx-row">
                      <span className="tx-ts">{fmtTs(s.start_ms)}</span>
                      <span className="tx-text">
                        {s.speaker && (
                          <span className="speaker">{s.speaker}</span>
                        )}
                        {s.text}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="loading-mono">transcript not ready yet…</p>
                )}
              </div>
            </div>
          )}
      </aside>
      )}
      </div>

      {confirmOpen && (
        <div className="confirm-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h3>Delete this call?</h3>
            <p className="sub">
              Removes recordings from storage and erases transcripts,
              embeddings, and the AI report.
            </p>
            <div className="target">{c.title}</div>
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

/* ===== Side nav ===== */

function SideNav({
  active,
  call,
  showSections,
}: {
  active: string;
  call: CallDTO["call"];
  showSections: boolean;
}) {
  return (
    <aside className="sidebar">
      <span className="label">On this page</span>
      {showSections && (
        <nav className="nav-list">
          {NAV_SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={active === s.id ? "active" : ""}
              data-target={s.id}
            >
              <span className="num">{s.num}</span>
              {s.label}
            </a>
          ))}
        </nav>
      )}
      <div className="sidebar-foot">
        <span className="meta">
          <span className="k">owner</span>
          {call.salesperson_name}
        </span>
        <span className="meta">
          <span className="k">client</span>
          {call.client_name}
        </span>
        <span className="meta">
          <span className="k">indexed</span>
          {fmtAdded(call.created_at)}
        </span>
      </div>
    </aside>
  );
}

/* ===== Sections ===== */

function SectionHeader({
  num,
  label,
  title,
  action,
}: {
  num: string;
  label: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="sec-header">
      <span className="num">{num}</span>
      <div>
        <span className="label">{label}</span>
        <h2>{title}</h2>
        {action && <div className="sec-action">{action}</div>}
      </div>
    </header>
  );
}

function SummarySection({ report }: { report: CallReport }) {
  const s = report.summary;
  if (!s) return null;
  const rubric = s.rep_performance_rubric ?? {};
  const rubricEntries = Object.entries(rubric);
  const rubricAvg = rubricEntries.length
    ? rubricEntries.reduce((a, [, v]) => a + (v ?? 0), 0) / rubricEntries.length
    : 0;
  const scoreOutOfTen = Math.round(rubricAvg * 2 * 10) / 10;
  return (
    <section className="sec" id="summary">
      <SectionHeader
        num="01"
        label="Summary"
        title={firstSentence(s.tldr) || "Call summary"}
      />
      <div className="sec-body">
        <p className="summary-body">{s.tldr}</p>

        <div className="stat-row">
          <div>
            <span className="score">{scoreOutOfTen}</span>
            <span className="denom">/ 10</span>
          </div>
          <div className="chips">
            <span className="tag">{s.outcome.replace(/_/g, " ")}</span>
            <span className="tag">{s.deal_health}</span>
            <span className="tag">
              {Math.round(s.duration_minutes_total)} min
            </span>
          </div>
        </div>

        <div className="rubric">
          {rubricEntries.map(([label, v]) => (
            <div key={label} className="rubric-row">
              <span className="rk">{label}</span>
              <span className="rubric-bar">
                <span style={{ width: `${((v ?? 0) / 5) * 100}%` }} />
              </span>
              <span className="rv">{v}/5</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TimelineSection({
  report,
  onSeek,
  isPlaying,
}: {
  report: CallReport;
  onSeek: (rec: number, ms: number) => void;
  isPlaying: (rec: number, ms: number) => boolean;
}) {
  const moments = report.key_moments ?? [];
  if (moments.length === 0) return null;
  return (
    <section className="sec" id="timeline">
      <SectionHeader
        num="02"
        label="Timeline"
        title="Moments worth re-reading."
      />
      <div className="sec-body">
        <div className="tl">
          {moments.map((m, i) => {
            const playing = isPlaying(m.recording_index, m.start_ts_ms);
            return (
              <div
                key={i}
                className={`tl-row${playing ? " is-playing" : ""}`}
              >
                <JumpBtn
                  onClick={() => onSeek(m.recording_index, m.start_ts_ms)}
                  ts={fmtTs(m.start_ts_ms)}
                />
                <span className="tag-cell">
                  <span className="tag tag--muted">
                    {m.label.replace(/_/g, " ")}
                  </span>
                </span>
                <span className="desc">
                  {m.what_happened}
                  {m.why_it_matters ? ` ${m.why_it_matters}` : ""}
                  {m.quote && (
                    <span className="quote">&ldquo;{m.quote}&rdquo;</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RewritesSection({
  report,
  onSeek,
  isPlaying,
}: {
  report: CallReport;
  onSeek: (rec: number, ms: number) => void;
  isPlaying: (rec: number, ms: number) => boolean;
}) {
  const rewrites = report.rewrites ?? [];
  if (rewrites.length === 0) return null;
  return (
    <section className="sec" id="rewrites">
      <SectionHeader
        num="03"
        label="Rewrites"
        title="Higher leverage moves."
      />
      <div className="sec-body">
        <div className="rw-list">
          {rewrites.map((r, i) => {
            const playing = isPlaying(r.recording_index, r.start_ts_ms);
            return (
              <article
                key={i}
                className={`rw${playing ? " is-playing" : ""}`}
              >
                <div className="rw-top">
                  <JumpBtn
                    onClick={() => onSeek(r.recording_index, r.start_ts_ms)}
                    ts={fmtTs(r.start_ts_ms)}
                  />
                  <span className="tag tag--accent">
                    <span className="dot" />rewrite
                  </span>
                </div>
                {r.client_said && (
                  <>
                    <span className="rw-label">Client said</span>
                    <p className="rw-quote client">{r.client_said}</p>
                  </>
                )}
                <span className="rw-label">You said</span>
                <p className="rw-quote">{r.original}</p>
                <span className="rw-label">Better approach</span>
                <p className="rw-better">{r.rewrite}</p>
                <span className="rw-label">Why</span>
                <p className="rw-why">
                  {r.rationale} — from {r.playbook_source.title} ·{" "}
                  {fmtTs(r.playbook_source.start_ts_ms)}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PatternsSection({
  report,
  onSeek,
}: {
  report: CallReport;
  onSeek: (rec: number, ms: number) => void;
}) {
  const patterns = report.patterns ?? [];
  if (patterns.length === 0) return null;
  return (
    <section className="sec" id="patterns">
      <SectionHeader
        num="04"
        label="Patterns"
        title="What keeps showing up across your calls."
      />
      <div className="sec-body">
        <div className="pat">
          {patterns.map((p, i) => (
            <div key={i} className="pat-row">
              <h3>{p.name}</h3>
              <p className="desc">{p.description}</p>
              {(p.evidence ?? []).length > 0 && (
                <div className="pat-ev">
                  {(p.evidence ?? []).map((e, j) => (
                    <button
                      key={j}
                      type="button"
                      className="pat-ev-link"
                      onClick={() => onSeek(e.recording_index, e.start_ts_ms)}
                    >
                      rec {e.recording_index} · {fmtTs(e.start_ts_ms)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ===== Jump button (prototype shape) ===== */

function JumpBtn({ onClick, ts }: { onClick: () => void; ts: string }) {
  return (
    <button
      type="button"
      className="jump"
      onClick={onClick}
      aria-label={`Jump to ${ts}`}
    >
      <span className="ring">
        <svg width="7" height="7" viewBox="0 0 10 10">
          <polygon points="3,1 3,9 9,5" fill="currentColor" />
        </svg>
      </span>
      <span className="ts">{ts}</span>
    </button>
  );
}

/* ===== Scrubber line ===== */

function Scrub({
  durationMs,
  currentMs,
  moments,
  onScrub,
  onMarkerClick,
}: {
  durationMs: number | null;
  currentMs: number;
  moments: KeyMoment[];
  onScrub: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMarkerClick: (ms: number) => void;
}) {
  const headPct =
    durationMs && durationMs > 0
      ? Math.min(100, Math.max(0, (currentMs / durationMs) * 100))
      : 0;
  return (
    <div className="scrub" onClick={onScrub} role="slider" aria-valuemin={0}>
      <div className="track" />
      {durationMs && durationMs > 0 &&
        moments.map((m, i) => {
          const pct = Math.min(
            100,
            Math.max(0, (m.start_ts_ms / durationMs) * 100),
          );
          return (
            <button
              key={i}
              type="button"
              className="marker"
              style={{ left: `${pct}%` }}
              onClick={(e) => {
                e.stopPropagation();
                onMarkerClick(m.start_ts_ms);
              }}
              aria-label={`Jump to ${fmtTs(m.start_ts_ms)}`}
            >
              <span className="tip">
                <span className="tip-ts">{fmtTs(m.start_ts_ms)}</span>{" "}
                {m.label.replace(/_/g, " ")}
              </span>
            </button>
          );
        })}
      <div className="head" style={{ left: `${headPct}%` }} />
    </div>
  );
}

/* ===== Progress stepper (unchanged) ===== */

const STAGES: Array<{ key: CallStatus; label: string; blurb: string }> = [
  { key: "queued", label: "queued", blurb: "waiting for a worker" },
  { key: "transcribing", label: "transcribing", blurb: "AssemblyAI is converting audio to text" },
  { key: "embedding", label: "embedding", blurb: "indexing the transcript for retrieval" },
  { key: "analyzing", label: "analyzing", blurb: "Claude is reading the call against the playbook" },
];

function ProgressStepper({
  status,
  recordings,
}: {
  status: CallStatus;
  recordings: RecordingDTO[];
}) {
  const activeIdx = STAGES.findIndex((s) => s.key === status);
  return (
    <div className="progress-card" style={{ marginTop: 24 }}>
      <p className="card-label">processing</p>
      <ol className="stepper">
        {STAGES.map((s, i) => {
          const state =
            i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
          return (
            <li key={s.key} className={`step ${state}`}>
              <span className="dot" aria-hidden>
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className="lbl">{s.label}</span>
              <span className="blurb">{s.blurb}</span>
            </li>
          );
        })}
      </ol>
      {recordings.length > 0 && (
        <div className="rec-chips">
          {recordings.map((r) => (
            <span
              key={r.id}
              className={`rec-chip s-${r.transcribe_status}`}
              title={r.transcribe_error ?? ""}
            >
              rec {String(r.recording_index).padStart(2, "0")} · {r.transcribe_status}
            </span>
          ))}
        </div>
      )}
      <p className="progress-hint">
        tap “Listen to call” to play recordings while this runs.
      </p>
    </div>
  );
}
