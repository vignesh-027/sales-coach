"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  VOYAGE_FREE_TIER_TOKENS_PER_MODEL,
  freeTierStatus,
  isVoyageFreeTierModel,
} from "@/services/voyage/free-tier";
import type {
  ObservabilityRecentRow,
  ObservabilityUsageRow,
} from "./page";

interface Props {
  year: number;
  month: number;
  currentYear: number;
  currentMonth: number;
  usage: ObservabilityUsageRow[];
  recent: ObservabilityRecentRow[];
  selectedModels: {
    llm: string;
    rerank: string;
    embed: string;
    transcribe: string;
  };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function fmtDuration(sec: number): string {
  if (!sec) return "0m";
  const m = sec / 60;
  if (m >= 60) return `${(m / 60).toFixed(1)}h`;
  return `${m.toFixed(1)}m`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stepMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = (y * 12 + (m - 1)) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

// Shared card style for each section — a simple, light box so sections are
// visually distinct without looking heavy.
const cardStyle: React.CSSProperties = {
  marginTop: 16,
  background: "var(--bg, #fff)",
  border: "0.5px solid var(--hair, rgba(10,10,10,0.12))",
  borderRadius: 6,
  padding: "18px 20px",
  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
};

export function ObservabilityClient({
  year,
  month,
  currentYear,
  currentMonth,
  usage,
  recent,
  selectedModels,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const isCurrent = year === currentYear && month === currentMonth;
  const isAtOrAfterCurrent =
    year > currentYear || (year === currentYear && month >= currentMonth);

  const goTo = (y: number, m: number) => {
    startTransition(() => {
      router.push(`${pathname}?year=${y}&month=${m}`);
    });
  };
  const goPrev = () => {
    const { y, m } = stepMonth(year, month, -1);
    goTo(y, m);
  };
  const goNext = () => {
    if (isAtOrAfterCurrent) return;
    const { y, m } = stepMonth(year, month, 1);
    goTo(y, m);
  };
  const goCurrent = () => goTo(currentYear, currentMonth);

  // Bucket usage rows.
  const voyageEmbed = usage.filter(
    (u) => u.provider === "voyage" && u.kind === "embed" && u.tokens > 0,
  );
  const voyageRerank = usage.filter(
    (u) => u.provider === "voyage" && u.kind === "rerank" && u.tokens > 0,
  );
  const llm = usage.filter((u) => u.provider === "anthropic" && u.tokens > 0);
  const transcribe = usage.filter(
    (u) => u.provider === "assemblyai" && u.duration_sec > 0,
  );

  // Free-tier rollup — only Voyage models that were actually used this month.
  const tokensByVoyageModel = new Map<string, number>();
  for (const u of usage) {
    if (
      u.provider === "voyage" &&
      isVoyageFreeTierModel(u.model) &&
      u.tokens > 0
    ) {
      tokensByVoyageModel.set(
        u.model,
        (tokensByVoyageModel.get(u.model) ?? 0) + u.tokens,
      );
    }
  }
  const voyageFreeTierRows = Array.from(tokensByVoyageModel.entries())
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens);

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  return (
    <main className="shell">
      {/* Loading bar — fixed at top, animates during route transition. */}
      <ObsLoadingBar active={isPending} />

      {/* Header: title (left) ⟷ filter (right) */}
      <section
        className="page-head"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <h1 className="top-title">
          Observability<span className="dot">.</span>
        </h1>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            opacity: isPending ? 0.6 : 1,
            transition: "opacity 120ms ease-out",
          }}
        >
          <ObsIconBtn
            onClick={goPrev}
            ariaLabel="Previous month"
            disabled={isPending}
          >
            <ChevronLeft />
          </ObsIconBtn>
          <div
            style={{
              minWidth: 160,
              textAlign: "center",
              fontWeight: 600,
              fontSize: 15,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {monthLabel}
            {isPending && <Spinner />}
          </div>
          {!isCurrent && (
            <ObsIconBtn
              onClick={goCurrent}
              ariaLabel="Reset to current month"
              disabled={isPending}
              title="Reset to current month"
            >
              <ResetIcon />
            </ObsIconBtn>
          )}
          <ObsIconBtn
            onClick={goNext}
            ariaLabel="Next month"
            disabled={isAtOrAfterCurrent || isPending}
            title={
              isAtOrAfterCurrent
                ? "No records for future months"
                : "Next month"
            }
          >
            <ChevronRight />
          </ObsIconBtn>
        </div>
      </section>

      {/* Selected models */}
      <section className="admin-table-wrap" style={cardStyle}>
        <h2 className="section-title">Selected models</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Model</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>LLM (analysis)</td>
              <td>{selectedModels.llm}</td>
              <td>Settings → Configuration</td>
            </tr>
            <tr>
              <td>Voyage rerank</td>
              <td>{selectedModels.rerank}</td>
              <td>Settings → Configuration</td>
            </tr>
            <tr>
              <td>Voyage embed</td>
              <td>{selectedModels.embed}</td>
              <td>Hard-coded (re-embedding required to change)</td>
            </tr>
            <tr>
              <td>Transcription</td>
              <td>{selectedModels.transcribe}</td>
              <td>Hard-coded (AssemblyAI)</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Voyage — one section, two subsections (free limit, model usage). */}
      <section className="admin-table-wrap" style={cardStyle}>
        <h2 className="section-title">Voyage ({monthLabel})</h2>

        <h3 style={{ marginTop: 12, marginBottom: 6, fontSize: 14 }}>
          Free-tier — {fmtNum(VOYAGE_FREE_TIER_TOKENS_PER_MODEL)} tokens per
          model per month
        </h3>
        {voyageFreeTierRows.length === 0 ? (
          <p className="sub">No Voyage usage this month.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Tokens used</th>
                <th>Limit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {voyageFreeTierRows.map(({ model, tokens }) => {
                const s = freeTierStatus(model, tokens);
                return (
                  <tr key={model}>
                    <td>{model}</td>
                    <td>{fmtNum(tokens)}</td>
                    <td>{fmtNum(s.limit)}</td>
                    <td>
                      <FreeTierBadge model={model} tokens={tokens} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <h3 style={{ marginTop: 16, marginBottom: 6, fontSize: 14 }}>
          Model usage
        </h3>
        {voyageEmbed.length === 0 && voyageRerank.length === 0 ? (
          <p className="sub">No Voyage usage this month.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Model</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {[...voyageEmbed, ...voyageRerank].map((r) => (
                <tr key={`${r.kind}-${r.model}`}>
                  <td>{r.kind}</td>
                  <td>{r.model}</td>
                  <td>{fmtNum(r.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* LLM */}
      <UsageTable
        title={`LLM (${monthLabel})`}
        emptyHint="No analyses ran this month."
        rows={llm}
        columns={["model", "in_out", "tokens"]}
      />

      {/* AssemblyAI */}
      <UsageTable
        title={`AssemblyAI transcription (${monthLabel})`}
        emptyHint="No transcriptions captured this month."
        rows={transcribe}
        columns={["model", "duration"]}
      />

      {/* Recent activity */}
      <section className="admin-table-wrap" style={cardStyle}>
        <h2 className="section-title">
          Recent activity ({monthLabel}) — calls & knowledge with model usage
        </h2>
        {recent.length === 0 ? (
          <p className="sub">
            Nothing happened in this month yet. Try a different month, or run a
            call analysis / upload knowledge.
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Title</th>
                <th>Models used</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={`${r.scope_id}-${r.last_activity}`}>
                  <td>{fmtDate(r.last_activity)}</td>
                  <td>{r.kind}</td>
                  <td>
                    {r.kind === "call" ? (
                      <Link href={`/calls/${r.scope_id}?from=observability`}>
                        {r.title}
                      </Link>
                    ) : (
                      r.title
                    )}
                  </td>
                  <td>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {r.models.map((m) => (
                        <li
                          key={`${m.provider}-${m.kind}-${m.model}`}
                          style={{ fontSize: 13, lineHeight: 1.5 }}
                        >
                          <strong>
                            {m.provider}/{m.kind}
                          </strong>{" "}
                          <code style={{ fontSize: 12 }}>{m.model}</code>
                          {m.duration_sec > 0
                            ? ` · ${fmtDuration(m.duration_sec)}`
                            : null}
                          {m.tokens > 0 ||
                          m.input_tokens > 0 ||
                          m.output_tokens > 0 ? (
                            <span>
                              {" · "}
                              {m.input_tokens > 0 || m.output_tokens > 0
                                ? `in ${fmtNum(m.input_tokens)} / out ${fmtNum(m.output_tokens)}`
                                : `${fmtNum(m.tokens)} tok`}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function FreeTierBadge({ model, tokens }: { model: string; tokens: number }) {
  if (!isVoyageFreeTierModel(model)) {
    return <span style={{ color: "#888" }}>—</span>;
  }
  const s = freeTierStatus(model, tokens);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: s.exceeded ? "#fde0e0" : "#dff5e1",
        color: s.exceeded ? "#a11" : "#196b27",
      }}
      title={`${tokens.toLocaleString()} / ${s.limit.toLocaleString()} tokens (${s.pct.toFixed(1)}%)`}
    >
      {s.exceeded
        ? `Exceeded (${s.pct.toFixed(0)}%)`
        : `Inside limit (${s.pct.toFixed(1)}%)`}
    </span>
  );
}

function UsageTable({
  title,
  emptyHint,
  rows,
  columns,
}: {
  title: string;
  emptyHint: string;
  rows: ObservabilityUsageRow[];
  columns: Array<"model" | "tokens" | "in_out" | "duration">;
}) {
  return (
    <section className="admin-table-wrap" style={cardStyle}>
      <h2 className="section-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="sub">{emptyHint}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              {columns.includes("model") && <th>Model</th>}
              {columns.includes("in_out") && (
                <>
                  <th>Input</th>
                  <th>Output</th>
                </>
              )}
              {columns.includes("tokens") && <th>Tokens</th>}
              {columns.includes("duration") && <th>Audio duration</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.provider}-${r.kind}-${r.model}`}>
                {columns.includes("model") && <td>{r.model}</td>}
                {columns.includes("in_out") && (
                  <>
                    <td>{fmtNum(r.input_tokens)}</td>
                    <td>{fmtNum(r.output_tokens)}</td>
                  </>
                )}
                {columns.includes("tokens") && <td>{fmtNum(r.tokens)}</td>}
                {columns.includes("duration") && (
                  <td>{fmtDuration(r.duration_sec)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─── Icon button (filter controls) ──────────────────────────────────────────
function ObsIconBtn({
  onClick,
  ariaLabel,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      disabled={disabled}
      className="obs-icon-btn"
      style={{
        width: 32,
        height: 32,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        background: "transparent",
        border: "0.5px solid var(--hair, rgba(10,10,10,0.2))",
        borderRadius: 4,
        color: "var(--ink-1, #111)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transition: "background 150ms ease, color 150ms ease, border-color 150ms ease",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "var(--accent, #5C4A8A)";
        e.currentTarget.style.color = "#fff";
        e.currentTarget.style.borderColor = "var(--accent, #5C4A8A)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--ink-1, #111)";
        e.currentTarget.style.borderColor = "var(--hair, rgba(10,10,10,0.2))";
      }}
    >
      {children}
    </button>
  );
}

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function ResetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 12,
        height: 12,
        border: "1.5px solid var(--hair, rgba(10,10,10,0.2))",
        borderTopColor: "var(--accent, #5C4A8A)",
        borderRadius: "50%",
        display: "inline-block",
        animation: "obs-spin 700ms linear infinite",
      }}
    />
  );
}

function ObsLoadingBar({ active }: { active: boolean }) {
  return (
    <>
      <style>{`
        @keyframes obs-spin { to { transform: rotate(360deg); } }
        @keyframes obs-bar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: "transparent",
          overflow: "hidden",
          zIndex: 9999,
          pointerEvents: "none",
          opacity: active ? 1 : 0,
          transition: "opacity 150ms ease-out",
        }}
      >
        <div
          style={{
            width: "40%",
            height: "100%",
            background: "var(--accent, #5C4A8A)",
            animation: active ? "obs-bar 1.1s ease-in-out infinite" : "none",
          }}
        />
      </div>
    </>
  );
}
