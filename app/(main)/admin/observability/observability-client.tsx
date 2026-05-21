"use client";

import Link from "next/link";

interface UsageWindow {
  embed_tokens: number;
  rerank_tokens: number;
  embed_cost_usd: number;
  rerank_cost_usd: number;
  by_model: Array<{
    kind: "embed" | "rerank";
    model: string;
    tokens: number;
    cost_usd: number;
  }>;
}

interface Lifetime {
  embed: number;
  rerank: number;
  total: number;
}

interface ClaudeRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
}

interface Averages {
  sample_size: number;
  avg_fused_candidates: number;
  avg_kept: number;
  avg_dropped: number;
}

interface Recent {
  call_id: string;
  created_at: string;
  fused_candidates: number;
  rerank_kept: number;
  rerank_dropped: number;
  rerank_model: string | null;
}

// Voyage publishes a 200M-token free tier across embed + rerank for our plan.
// Hard-coded here so there's one number to edit if terms change. The check
// uses >= so the boundary itself counts as "billing active" (conservative).
const VOYAGE_FREE_TIER_TOKENS = 200_000_000;

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
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

export function ObservabilityClient({
  usage,
  lifetime,
  claude,
  averages,
  recent,
}: {
  usage: UsageWindow;
  lifetime: Lifetime;
  claude: ClaudeRow[];
  averages: Averages;
  recent: Recent[];
}) {
  const totalTokens = usage.embed_tokens + usage.rerank_tokens;
  const claudeInput = claude.reduce((s, r) => s + r.input_tokens, 0);
  const claudeOutput = claude.reduce((s, r) => s + r.output_tokens, 0);
  const claudeTotal = claudeInput + claudeOutput;
  const freeTierPct = Math.min(
    100,
    (lifetime.total / VOYAGE_FREE_TIER_TOKENS) * 100,
  );
  const billingActive = lifetime.total >= VOYAGE_FREE_TIER_TOKENS;

  return (
    <>
      <main className="shell">
        <section className="page-head">
          <h1 className="top-title">
            Observability<span className="dot">.</span>
          </h1>
          <p className="sub">
            Voyage + Claude token rollups and per-analysis retrieval funnels.
            Window: last 30 days.
          </p>
        </section>

        <section className="settings-tiles">
          <div className="settings-tile">
            <div className="settings-tile-left">
              <h3>Voyage tokens (30d)</h3>
              <p>
                Embed: {fmtNum(usage.embed_tokens)} · Rerank:{" "}
                {fmtNum(usage.rerank_tokens)}
              </p>
            </div>
            <div className="settings-tile-right">
              <div className="settings-tile-value">{fmtNum(totalTokens)}</div>
              <div className="settings-tile-meta">total tokens</div>
            </div>
          </div>

          <div className="settings-tile">
            <div className="settings-tile-left">
              <h3>
                Voyage free tier{" "}
                <span
                  style={{
                    display: "inline-block",
                    marginLeft: 8,
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    background: billingActive ? "#fde0e0" : "#dff5e1",
                    color: billingActive ? "#a11" : "#196b27",
                  }}
                >
                  {billingActive ? "Billing active" : "Free tier"}
                </span>
              </h3>
              <p>
                {fmtNum(lifetime.total)} / {fmtNum(VOYAGE_FREE_TIER_TOKENS)}{" "}
                lifetime tokens used · embed {fmtNum(lifetime.embed)} · rerank{" "}
                {fmtNum(lifetime.rerank)}
              </p>
              <div
                style={{
                  marginTop: 8,
                  width: "100%",
                  height: 6,
                  borderRadius: 999,
                  background: "#eee",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${freeTierPct}%`,
                    height: "100%",
                    background: billingActive ? "#c33" : "#2a8a3a",
                    transition: "width 200ms ease",
                  }}
                />
              </div>
            </div>
            <div className="settings-tile-right">
              <div className="settings-tile-value">
                {freeTierPct.toFixed(2)}%
              </div>
              <div className="settings-tile-meta">of free tier used</div>
            </div>
          </div>

          <div className="settings-tile">
            <div className="settings-tile-left">
              <h3>Claude tokens (30d)</h3>
              <p>
                Input: {fmtNum(claudeInput)} · Output: {fmtNum(claudeOutput)}
              </p>
            </div>
            <div className="settings-tile-right">
              <div className="settings-tile-value">{fmtNum(claudeTotal)}</div>
              <div className="settings-tile-meta">total tokens</div>
            </div>
          </div>

          <div className="settings-tile">
            <div className="settings-tile-left">
              <h3>Retrieval funnel (avg over 30d)</h3>
              <p>
                {averages.sample_size} analyses · fused candidates →{" "}
                {averages.avg_fused_candidates.toFixed(1)} · kept{" "}
                {averages.avg_kept.toFixed(1)} · dropped{" "}
                {averages.avg_dropped.toFixed(1)}
              </p>
            </div>
            <div className="settings-tile-right">
              <div className="settings-tile-value">
                {averages.avg_kept.toFixed(1)}
              </div>
              <div className="settings-tile-meta">avg chunks shown to LLM</div>
            </div>
          </div>
        </section>

        {usage.by_model.length > 0 && (
          <section className="admin-table-wrap" style={{ marginTop: 16 }}>
            <h2 className="section-title">Voyage by model (30d)</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Model</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {usage.by_model.map((m) => (
                  <tr key={`${m.kind}-${m.model}`}>
                    <td>{m.kind}</td>
                    <td>{m.model}</td>
                    <td>{fmtNum(m.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {claude.length > 0 && (
          <section className="admin-table-wrap" style={{ marginTop: 16 }}>
            <h2 className="section-title">Claude by model (30d)</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Input tokens</th>
                  <th>Output tokens</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {claude.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}</td>
                    <td>{fmtNum(m.input_tokens)}</td>
                    <td>{fmtNum(m.output_tokens)}</td>
                    <td>{fmtNum(m.input_tokens + m.output_tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="admin-table-wrap" style={{ marginTop: 16 }}>
          <h2 className="section-title">Recent analyses</h2>
          {recent.length === 0 ? (
            <p className="sub">No analyses captured yet. Re-analyze a call to see it here.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Call</th>
                  <th>Fused</th>
                  <th>Kept</th>
                  <th>Dropped</th>
                  <th>Reranker</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={`${r.call_id}-${r.created_at}`}>
                    <td>{fmtDate(r.created_at)}</td>
                    <td>
                      {/* ?from=observability lets the call-detail Close
                          button send the user back here instead of /calls. */}
                      <Link href={`/calls/${r.call_id}?from=observability`}>
                        {r.call_id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td>{r.fused_candidates}</td>
                    <td>{r.rerank_kept}</td>
                    <td>{r.rerank_dropped}</td>
                    <td>{r.rerank_model ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
