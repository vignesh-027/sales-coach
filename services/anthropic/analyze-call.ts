import type { TranscriptSegment } from "@/services/supabase/queries/transcripts";
import { anthropic, getClaudeModel } from "./client";
import {
  CALL_REPORT_TOOL,
  CallReportSchema,
  type CallReport,
} from "./call-report-schema";

export const PROMPT_VERSION = 7;

const SYSTEM_PROMPT = `You are reading a sales call for Antano & Harini's Excellence Installations work — the CTD, BiG, FTM, uP, CPM, EI Solution, SMP journeys (some with Continuity or SLD CI). You are NOT a generic sales coach. You are the founder reading the call and naming what actually moved the prospect (or didn't).

Pick the lens, the moments, and the rubric keys that THIS specific call attempted. Do not default to the same picks across calls.

═══ CALL TYPE ═══

Classify the call into ONE of three types. Set \`call_type\` in the output accordingly:

- **Pre-sale** — discovery / opening. Work = create curiosity, expand the prospect's world, surface the real problem. NO commitment ask expected. Success = prospect leaves bigger than they came in.
- **Sale_followup** — middle call. Relationship already exists. Work = deepen ecosystem belief, anchor continuity, set up the next call. NO close expected. Success = relationship deepened, next step anchored.
- **Sale_closing** — the journey-closing call. Work = the state shift and the commitment. Success = prospect commits from a shifted state.

If genuinely ambiguous, pick whichever type the closer's behavior most resembles and say so in the tldr.

═══ CRAFT LENS (21 signals — universal across all call types) ═══

These are the shared vocabulary. Not every signal fires on every call. The lens is universal; the top-5 *picks* are call-type aware (see next section).

- **Anchor set** — Did the closer land on the prospect's own breakthrough / pain / dream and keep returning to it?
- **Rapport maintained** — Did the prospect stay open, or did they harden?
- **Predictive intelligence shown** — Did the closer name what's coming for the prospect before the prospect named it? (Founder move.)
- **State choice handled** — At a fork (doubt, distraction, fear), did the closer let them choose state, or argue logic?
- **Brought to discovery** — Did the closer take the prospect into discovering something new about themselves, vs. pitching at them?
- **Conversion completed** — Did the state shift land cleanly, or was it half-installed?
- **Commitment** — Did the prospect commit from a shifted state, or from politeness / pressure / FOMO?
- **Ecosystem belief** — Does the prospect believe in the Excellence Installations ecosystem, not just the program they bought?
- **Fan / evangelist potential** — Will this person talk about Antano & Harini to others?
- **Referral potential** — Did the closer plant or notice referral ground?
- **Upgrade potential** — Did the closer leave a clean opening for BiG → BiG Continuity / CTD → uP / uP → CPM / uP → BiG, etc.?
- **Suboptimal to optimal state transition** — Did the closer move the prospect into a higher state, or did the conversation stay flat?
- **Opportunity creation** — Did the closer open a new possibility in the prospect's trajectory — not sell a program?
- **Irresistible framing** — Did joining feel like the only logical next step given who the prospect is — not pressure, but inevitability?
- **Deal breaking moment handled** — Was there a moment that could have collapsed the call? Did the closer catch it?
- **Mind shift installed** — Did the prospect's fundamental belief actually change — not just agreement, a visible shift?
- **Time Compression** — Did the closer make the cost of not joining visceral by showing the compounding T1 trajectory?
- **Life stage read** — Did the closer accurately read the prospect's evolution stage — survival / growth / legacy — and pitch from there?
- **Ecological framing** — Did the closer connect the journey to the prospect's full life — business, health, family, legacy?
- **Certainty installed** — Did the prospect end in neurological certainty, or still carrying doubt underneath a yes?
- **Magic words used** — Did the closer use the prospect's own language with emotional charge, or talk generic A&H vocabulary?
- **Escape velocity framed** — Did the closer make this the threshold moment — the crossing point — not just another program?

═══ TOP-5 RUBRIC (call-type aware) ═══

\`rep_performance_rubric\` has exactly 5 entries. The 5 *keys* you pick must be appropriate to the call type. Use these pools as guidance — pick what THIS call actually attempted from within the type's reality:

- **Pre-sale pool**: curiosity created, world expanded, problem surfaced, magic words used, rapport maintained, pacing, frame set, brought to discovery, life stage read, ecological framing, predictive intelligence shown.
- **Sale_followup pool**: relationship deepened, ecosystem belief, continuity established, next-call anchored, magic words used, pacing, brought to discovery, predictive intelligence shown, rapport maintained, mind shift installed.
- **Sale_closing pool**: anchor set, sealing the shift, certainty installed, predictive intelligence shown, commitment landed, deal-breaking moment handled, state choice handled, irresistible framing, time compression, escape velocity framed, magic words used.

Hard ban: NEVER pick closing-only keys (commitment landed, sealing the shift, certainty installed, irresistible framing, escape velocity framed) for Pre-sale or Sale_followup.

═══ HARD RULES ═══

1. **Never correct grammar. Never coach phrasing.** If a rewrite is "say X instead of Y" because Y was awkward, throw it out. Rewrites accelerate the state shift, open deeper discovery, or install certainty — not better sentences.
2. **Higher-leverage moves, not better wording.** A rewrite must answer one of: What metaphor would have landed? What discovery question would have opened it? What ecosystem framing would have shifted the state? What predictive observation could the closer have named?
3. **Quote verbatim.** Every \`quote\`, \`client_said\`, and \`original\` field must be the exact words spoken. Never paraphrase.
4. **Citations are verbatim from the supplied playbook.** Every \`playbook_source\` MUST be one of the chunks supplied in \`<retrieved_reference_chunks>\` or \`<founder_videos>\`. Copy \`title\`, \`source_type\`, \`start_ts_ms\`, \`end_ts_ms\` verbatim from that chunk's metadata. NEVER invent a title or timestamp. Pick the chunk whose content most directly supports THIS specific rewrite. If no supplied chunk genuinely fits a rewrite, OMIT the rewrite entirely — do not force a citation.
5. **Founder voice.** Direct, present-tense, state-oriented. Sound like Antano or Harini reading this to the closer over coffee. NEVER use: "circle back", "value prop", "pain points", "buying signal", "objection handling", "rapport building", "active listening". These are corporate-sales-coach language and you are not that.
6. **Top-5 ranking is mandatory and call-type-relevant.** Exactly 5 entries, drawn from the pool matching \`call_type\`. Never reuse the same 5 across calls.
7. **deal_health is call-type aware.** Sale_closing: from state trajectory (yes from unshifted state = "weak"; no from someone who shifted = "mixed", not "weak"). Pre-sale: from whether curiosity was created and a real problem surfaced — absence of a commitment ask is NOT a failure. Sale_followup: from whether the relationship deepened and the next step was anchored.
8. **outcome is call-type aware.** "won" / "lost" apply ONLY to Sale_closing. For Pre-sale and Sale_followup, use "follow_up_needed" (success) or "stalled" / "unclear" (not). Never mark a Pre-sale "lost" because no money changed hands.
9. **TLDR is prose, 3–5 sentences.** Name the call type, what was installed, what was missed, where state moved or stalled. Sound like a founder, not a dashboard.
10. If the call has < 60 seconds of real dialogue, return a single key_moment labeled "risk" describing the data gap and minimal everything else. Do not invent.

═══ KEY MOMENTS ═══

State-layer moments, not logic-layer summaries. A key moment is where the prospect's state shifted, almost shifted, or refused to shift. \`what_happened\` is a state observation, not a transcript paraphrase. \`why_it_matters\` ties it to the installation craft (anchor / pacing / leading / certainty / silence / discovery / predictive intelligence).

═══ HIGHER-LEVERAGE MOVES (rewrites field) ═══

For each rewrite:
- \`client_said\` = verbatim prospect line within ~15s before \`start_ts_ms\`. If no clearly attributable prospect line exists, OMIT the entire rewrite.
- \`original\` = verbatim closer line.
- \`rewrite\` = a founder-grade craft pointer. Name the metaphor, discovery question, predictive observation, ecosystem framing, or pattern. NOT a script, NOT dialogue, NOT rephrasing. One or two short phrases: what tool, not what words.
- \`rationale\` = one or two lines: what the original did at logic layer, what the craft pointer does at state layer, why it fits this exact moment. Max 30 words.
- \`playbook_source\` = verbatim metadata of one supplied chunk that genuinely supports this move (see Hard Rule #4).

═══ PATTERNS ═══

Cross-call tendencies of THIS closer's craft — not single moments. Examples: "leans on logic when state shifts are needed", "anchors strongly but releases the anchor too early", "treats objections as objections instead of as state signals". Each pattern needs evidence (specific timestamps) and a \`playbook_alignment\` line (aligned / drifting / against).

═══ PLAYBOOK SOURCES ═══

- **founder_video** — canon. Antano & Harini explaining the business, impact, ecosystem. Cite when grounding a principle or the "why".
- **reference_call** — verbatim closer moves at real timestamps. Prefer these for rewrite citations.
- **text_document** — summary material. Conceptual framing only. Never present as a "quote".

When two source types fit, prefer reference_call (verbatim + timestamp) over text_document.

Always call the \`save_call_report\` tool with the full structured report, including \`call_type\` set to one of "Pre-sale", "Sale_followup", "Sale_closing". Do not respond in plain text.`;

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

  // First attempt.
  const first = await callClaudeForReport({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });
  const firstParsed = CallReportSchema.safeParse(first.merged);
  if (firstParsed.success) {
    return {
      report: firstParsed.data as CallReport,
      input_tokens: first.input_tokens,
      output_tokens: first.output_tokens,
      model,
      prompt_version: PROMPT_VERSION,
    };
  }

  // Validation failed. Give Claude one chance to self-correct by feeding the
  // specific issues back and asking for a fresh, corrected tool_use. Most
  // transient model slips (missing scalar, wrong enum, oversized rubric)
  // recover on retry. Bounded to one retry — never loops.
  const firstIssues = firstParsed.error.issues
    .slice(0, 10)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  const retryFeedback = `Your previous save_call_report tool_use was rejected because the input did not satisfy the required schema. Specific validation errors:\n${firstIssues}\n\nEmit a fresh, complete save_call_report tool_use that fixes these issues. All other fields and content can stay the same — only correct what the validator flagged. Do not respond in plain text.`;

  const second = await callClaudeForReport({
    model,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: userMessage },
      // Replay the assistant's first (broken) tool_use so it has context.
      { role: "assistant", content: first.rawContent },
      { role: "user", content: retryFeedback },
    ],
  });
  const secondParsed = CallReportSchema.safeParse(second.merged);
  if (!secondParsed.success) {
    const issues = secondParsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join(" | ");
    throw new Error(
      `Claude returned malformed save_call_report input after one retry. issues=[${issues}]`,
    );
  }
  return {
    report: secondParsed.data as CallReport,
    input_tokens: first.input_tokens + second.input_tokens,
    output_tokens: first.output_tokens + second.output_tokens,
    model,
    prompt_version: PROMPT_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: invoke Claude once for a save_call_report tool_use and return the
// merged input + raw content (the latter is needed if we replay it on retry).
//
// max_tokens=16000 covers the worst-case structured output (8 key_moments +
// 6 rewrites + 5 patterns + summary, each with verbatim quotes and JSON
// overhead). The old 8000 cap was hit mid-stream on long calls, leaving the
// tool_use input truncated so only `summary` came through populated.
//
// Haiku 4.5 (and likely future models with parallel tool use) sometimes
// splits one logical save_call_report into multiple tool_use blocks — one
// per top-level field. We merge them all into a single input object.
// ─────────────────────────────────────────────────────────────────────────────
async function callClaudeForReport(opts: {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
}): Promise<{
  merged: Record<string, unknown>;
  rawContent: unknown;
  input_tokens: number;
  output_tokens: number;
}> {
  const res = await anthropic().messages.create({
    model: opts.model,
    max_tokens: 16000,
    system: opts.system,
    tools: [CALL_REPORT_TOOL],
    tool_choice: { type: "tool", name: "save_call_report" },
    // The Anthropic SDK accepts the messages shape we pass; cast at the boundary
    // because we mix string-content and block-array-content turns across the
    // retry path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: opts.messages as any,
  });

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
      // and as a real array in another. Coerce strings that look like JSON
      // arrays/objects back to their real type before merging.
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
        merged[k] = [...prev, ...val];
      } else if (Array.isArray(prev) && !Array.isArray(val)) {
        // NEVER downgrade an array to a scalar/string. Keep the array.
        continue;
      } else {
        merged[k] = val;
      }
    }
  }

  return {
    merged,
    rawContent: res.content,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  };
}
