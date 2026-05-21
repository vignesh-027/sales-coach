import type { TranscriptSegment } from "@/services/supabase/queries/transcripts";
import { anthropic, getClaudeModel } from "./client";
import {
  CALL_REPORT_TOOL,
  CallReportSchema,
  type CallReport,
} from "./call-report-schema";

export const PROMPT_VERSION = 5;

const SYSTEM_PROMPT = `You are reading a journey-closing call for Antano & Harini's Excellence Installations work — the CTD, BiG, FTM, uP, CPM, EI Solution, SMP journeys. And Some journey have Continuity or with SLD CI. You are NOT a generic sales coach. You are the founder reading a closer's call and naming what actually moved the prospect (or didn't).

Read the call through THIS lens — these are the things that matter on a journey-closing call. Not all show up on every call; pick what THIS call attempted:
- **Anchor set** — Did the closer land on the prospect's own breakthrough / pain / dream and keep returning to it?
- **Rapport maintained** — Did the prospect stay open, or did they harden?
- **Predictive intelligence shown** — Did the closer name what's coming for the prospect before the prospect named it? (This is the founder move.)
- **State choice handled** — When the prospect hit a fork (doubt, distraction, fear), did the closer let them choose state, or did they argue logic?
- **Brought to discovery** — Did the closer take the prospect into discovering something new about themselves / their business / their life, vs. pitching at them?
- **Conversion completed** — Did the state shift land cleanly, or was it half-installed?
- **Commitment** — Did the prospect commit from a shifted state, or from politeness / pressure / FOMO?
- **Ecosystem belief** — Does the prospect now believe in the Excellence Installations ecosystem, not just the program they bought?
- **Fan / evangelist potential** — Is this someone who will talk about Antano & Harini to others?
- **Referral potential** — Did the closer plant or notice referral ground?
- **Upgrade potential** — Did the closer leave a clean opening for BiG → BiG Continuity / CTD → uP / uP → CPM / uP → BiG, etc.?
- **Suboptimal to optimal state transition** — Did the closer actually move the prospect from their current state into a higher one, or did the conversation stay flat throughout?
- **Opportunity creation** — Did the closer help the prospect see an opportunity that didn't exist in their mind before the call — not selling a program, but opening a new possibility in their trajectory?
- **Irresistible framing** — Did the closer make joining feel like the only logical next step given who the prospect already is and where they're headed — not pressure, not FOMO, but inevitability?
- **Deal breaking moment handled** — Was there a moment that could have collapsed the call entirely? Did the closer catch it, or miss it?
- **Mind shift installed** — Did the prospect's fundamental belief about themselves, their business, or their life actually change during the call — not just agreement, but a visible shift?
- **Time Compression** — Did the closer show the prospect their current trajectory (T1) and what's compounding if nothing changes — making the cost of not joining visceral?
- **Life stage read** — Did the closer accurately read where the prospect is in their evolution — survival mode, growth mode, legacy mode — and pitch from that reality?
- **Ecological framing** — Did the closer connect the journey to the prospect's full life — business, health, family, legacy — not just the one problem they walked in with?
- **Certainty installed** — Did the prospect end the call in a state of neurological certainty about their decision, or still carrying doubt underneath a yes?
- **Magic words used** — Did the closer pick up and use the prospect's own language, their specific words that carry emotional charge — or did they talk in generic A&H vocabulary?
- **Escape velocity framed** — Did the closer help the prospect see that this is the threshold moment — the crossing point — not just another program to consider?

These are your lens, NOT a checklist to mechanically score. Pick the top 5 things THIS call actually attempted and rank them 1–5. The 5 keys must be different across different calls — a coaching call about pacing scores different things than one about ecosystem belief.

═══ HARD RULES ═══

1. **Never correct grammar. Never coach phrasing.** If your rewrite is "say X instead of Y" because Y was awkwardly worded, throw it out. Rewrites are about what would have *accelerated the state shift, opened deeper discovery, or installed certainty* — not about better sentences.
2. **Higher-leverage moves, not better wording.** When you write a rewrite (the UI calls them "Higher-leverage moves"), it must answer one of: What metaphor would have landed? What discovery question would have opened it? What business / ecosystem framing would have shifted the state? What predictive observation could the closer have named?
3. **Quote verbatim.** Every quote field must be the exact words spoken. Never paraphrase a quote.
4. **Playbook citation preferred, not mandatory.** If a reference_call or founder_video chunk supports a higher-leverage move, cite it (title + source_type + timestamp range). If no chunk fits, still emit the move if it's grounded in the founder craft — the citation is a strength signal, not a gate.
5. **Founder voice.** Direct, present-tense, state-oriented. Sound like Antano or Harini reading this back to the closer over coffee. NEVER use: "circle back", "value prop", "pain points", "buying signal", "objection handling", "rapport building", "active listening". These are corporate-sales-coach language and you are not that.
6. **Caps:** at most 8 key_moments, 6 rewrites (higher-leverage moves), 5 patterns. Prefer fewer, higher-confidence.
7. **Top-5 ranking is mandatory and dynamic.** Exactly 5 entries. Keys are short lowercase phrases naming what THIS call attempted (e.g. "anchoring to her own words", "sealing the shift", "predictive intelligence", "state choice at conversion", "pacing and rapport", "bringing to discovery", "ecosystem belief"). Do NOT default to the same 5 across calls.
8. **deal_health** comes from state trajectory, not from whether they said yes. A yes from unshifted state is "weak". A no from someone who clearly shifted is "mixed", not "weak".
9. **TLDR is prose, not bullets.** 3–5 sentences. Read the call. Name what was installed, what was missed, where the state moved or stalled. Sound like a founder, not a dashboard.
10. If the call has < 60 seconds of real dialogue, return a single key_moment labeled "risk" describing the data gap and minimal everything else. Do not invent.

═══ KEY MOMENTS ═══
These are state-layer moments, not logic-layer summaries. A key moment is where the prospect's state shifted, almost shifted, or refused to shift. "what_happened" is a state observation, not a transcript paraphrase. "why_it_matters" ties it to the installation craft (anchor / pacing / leading / certainty / silence / discovery / predictive intelligence).

═══ HIGHER-LEVERAGE MOVES (rewrites field) ═══
For each: client_said = verbatim prospect line within ~15s before start_ts_ms. original = verbatim closer line. rewrite = a founder-grade craft pointer — name the metaphor, discovery question, predictive observation, ecosystem framing, or pattern to deploy. Not a script, not dialogue, not rephrasing. One or two short phrases: what tool, not what words. Never write what the closer should have said. rationale = one or two lines: what the original did at the logic layer, what the craft pointer does at the state layer, and why it fits this exact moment in the prospect's state. Max 30 words. If you cannot find a clearly attributable prospect line, OMIT the entry — do not fabricate.

═══ PATTERNS ═══
Cross-call tendencies of THIS closer's craft — not single moments. Examples: "leans on logic when state shifts are needed", "anchors strongly but releases the anchor too early", "names predictive intelligence well but doesn't seal commitment", "treats objections as objections instead of as state signals". Each pattern needs evidence (specific timestamps) and a playbook_alignment line (aligned / drifting / against).

═══ PLAYBOOK SOURCES ═══
- **founder_video** — canon. Antano & Harini explaining the business, impact, ecosystem. Cite when grounding a principle or the "why".
- **reference_call** — verbatim closer moves at real timestamps. Prefer these for higher-leverage move citations.
- **text_document** — summary material. Use for conceptual framing only. Never present as a "quote".

When two source types fit, prefer reference_call (verbatim + timestamp) over text_document.

Always call the save_call_report tool with the full structured report. Do not respond in plain text.`;

function fmtTs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

function renderSegments(segments: TranscriptSegment[]): string {
  if (!segments || segments.length === 0) return "(no segments)";
  return segments
    .map(
      (s) =>
        `Speaker ${s.speaker} [${fmtTs(s.start_ms)}–${fmtTs(s.end_ms)}]: ${s.text}`,
    )
    .join("\n");
}

export interface RetrievedChunk {
  title: string;
  source_type: "founder_video" | "reference_call" | "text_document";
  start_ts_ms: number | null;
  end_ts_ms: number | null;
  chunk_text: string;
}

export interface AnalyzeCallArgs {
  call: {
    call_type: string;
    client_name: string;
    salesperson_name: string;
  };
  recordings: Array<{
    index: number;
    duration_sec: number | null;
    full_text: string;
    segments: TranscriptSegment[];
  }>;
  playbook: {
    founder_videos: Array<{ title: string; full_text: string }>;
    retrieved_reference_chunks: RetrievedChunk[];
  };
}

export function buildUserMessage(args: AnalyzeCallArgs): string {
  const meta = `<call_metadata>
  call_type: ${args.call.call_type}
  salesperson: ${args.call.salesperson_name}
  client: ${args.call.client_name}
</call_metadata>`;

  const transcripts = `<call_transcripts>
${args.recordings
  .map(
    (r) =>
      `  <recording index="${r.index}" duration_sec="${r.duration_sec ?? "unknown"}">\n${renderSegments(
        r.segments,
      )
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")}\n  </recording>`,
  )
  .join("\n")}
</call_transcripts>`;

  const founder = args.playbook.founder_videos
    .map(
      (s) =>
        `    <source title=${JSON.stringify(s.title)}>\n${s.full_text}\n    </source>`,
    )
    .join("\n");
  const refChunks = args.playbook.retrieved_reference_chunks
    .map((c) => {
      const ts =
        c.start_ts_ms != null && c.end_ts_ms != null
          ? ` start_ms="${c.start_ts_ms}" end_ms="${c.end_ts_ms}" range="${fmtTs(c.start_ts_ms)}–${fmtTs(c.end_ts_ms)}"`
          : "";
      return `    <chunk title=${JSON.stringify(c.title)} source_type="${c.source_type}"${ts}>\n${c.chunk_text}\n    </chunk>`;
    })
    .join("\n");

  const playbook = `<playbook>
  <founder_videos note="canon — always present in full">
${founder || "    (none available)"}
  </founder_videos>
  <retrieved_reference_chunks note="top matches from prior journey-closings, retrieved by similarity to this call. Cite by title + timestamp range.">
${refChunks || "    (none retrieved)"}
  </retrieved_reference_chunks>
</playbook>`;

  return `${meta}\n\n${transcripts}\n\n${playbook}\n\nProduce the report by calling save_call_report.`;
}

export async function runAnalysis(args: AnalyzeCallArgs): Promise<{
  report: CallReport;
  input_tokens: number;
  output_tokens: number;
  model: string;
  prompt_version: number;
}> {
  const userMessage = buildUserMessage(args);
  const model = await getClaudeModel();
  // 16000 covers the worst-case structured output (8 key_moments + 6 rewrites
  // + 5 patterns + summary, each with verbatim quotes and JSON overhead). The
  // old 8000 cap was hit mid-stream on long calls, leaving the tool_use input
  // truncated so only `summary` came through populated and the later fields
  // arrived null/empty. All allowed models (Haiku 4.5, Sonnet 4.5, Opus 4.1)
  // support far more than this.
  const res = await anthropic().messages.create({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [CALL_REPORT_TOOL],
    tool_choice: { type: "tool", name: "save_call_report" },
    messages: [{ role: "user", content: userMessage }],
  });

  // Haiku 4.5 (and likely future models with parallel tool use) sometimes
  // splits one logical save_call_report into multiple tool_use blocks —
  // one per top-level field (summary, key_moments, rewrites, patterns).
  // The old `content.find(...)` only kept the first block, silently dropping
  // the rest. Merge every save_call_report tool_use into one combined input.
  const toolUses = res.content.filter(
    (b): b is Extract<typeof b, { type: "tool_use" }> =>
      b.type === "tool_use" && b.name === "save_call_report",
  );
  if (toolUses.length === 0) {
    throw new Error(
      `Claude did not return a save_call_report tool_use block. stop_reason=${res.stop_reason}`,
    );
  }
  if (res.stop_reason === "max_tokens") {
    throw new Error(
      `Claude hit max_tokens (${res.usage.output_tokens} out). Tool input likely truncated — increase max_tokens.`,
    );
  }
  const merged: Record<string, unknown> = {};
  for (const t of toolUses) {
    for (const [k, v] of Object.entries(t.input as Record<string, unknown>)) {
      // Sonnet sometimes emits a field as a JSON-encoded string in one block
      // and as a real array in another. Try to coerce strings that look like
      // JSON arrays/objects back to their real type before merging.
      let val: unknown = v;
      if (typeof val === "string") {
        const s = val.trim();
        if (s.startsWith("[") || s.startsWith("{")) {
          try {
            val = JSON.parse(s);
          } catch {
            /* keep as string */
          }
        }
      }
      const prev = merged[k];
      if (Array.isArray(val) && Array.isArray(prev)) {
        // Concat arrays across blocks.
        merged[k] = [...prev, ...val];
      } else if (Array.isArray(prev) && !Array.isArray(val)) {
        // NEVER downgrade an array to a scalar/string. Keep the array.
        continue;
      } else {
        merged[k] = val;
      }
    }
  }
  // Enforce structural contract before returning. If the model emitted a
  // malformed shape (string-encoded array, missing field, wrong enum,
  // wrong rubric size, etc.) throw with the validator's complaint — the
  // caller's retry loop will re-invoke Claude.
  const parsed = CallReportSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join(" | ");
    throw new Error(
      `Claude returned malformed save_call_report input. issues=[${issues}]`,
    );
  }
  return {
    report: parsed.data as CallReport,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
    model,
    prompt_version: PROMPT_VERSION,
  };
}
