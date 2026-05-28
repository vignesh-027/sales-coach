import type { TranscriptSegment } from "@/services/supabase/queries/transcripts";
import { anthropic, getClaudeModel } from "./client";
import {
  CALL_REPORT_TOOL,
  CallReportSchema,
  LLMCallReportSchema,
  type CallReport,
  type LLMCallReport,
} from "./call-report-schema";
import {
  mergeIntoTurns,
  detectCloserSpeaker,
  labelTurns,
  buildPairs,
  resolveExcerptToSegment,
  renderTurns,
  norm,
  type Pair,
  type Turn,
} from "./conversation-turns";

export const PROMPT_VERSION = 14;

// ─────────────────────────────────────────────────────────────────────────────
// Token discipline knobs. Applied before the API call so input is always
// bounded. Tunable; chosen to give Haiku 4.5 ample headroom (200k window).
// ─────────────────────────────────────────────────────────────────────────────
const FOUNDER_VIDEO_CHAR_CAP_TOTAL = 24_000; // ~6k tokens combined
const FOUNDER_VIDEO_CHAR_CAP_PER = 8_000;    // ~2k tokens per video
const REFERENCE_CHUNKS_CAP = 3;              // was 5

// ─────────────────────────────────────────────────────────────────────────────
// Anchor key_moments + patterns evidence back to real transcript segments.
// (Rewrites use the new pair_id materialization path — see
// materializeRewritesFromPairs.)
// ─────────────────────────────────────────────────────────────────────────────
function findSegmentForQuote(
  segments: TranscriptSegment[],
  quote: string,
): TranscriptSegment | null {
  if (!quote || !segments?.length) return null;
  const nq = norm(quote);
  if (nq.length < 8) return null;
  for (const s of segments) {
    if (norm(s.text).includes(nq)) return s;
  }
  for (let i = 0; i < segments.length; i++) {
    let acc = "";
    for (let j = i; j < Math.min(i + 6, segments.length); j++) {
      acc = acc ? acc + " " + norm(segments[j].text) : norm(segments[j].text);
      if (acc.includes(nq)) return segments[i];
    }
  }
  const head = nq.slice(0, 60);
  if (head.length >= 12) {
    for (const s of segments) {
      if (norm(s.text).includes(head)) return s;
    }
  }
  return null;
}

function anchorMomentsAndPatterns(
  report: CallReport,
  recordings: AnalyzeCallArgs["recordings"],
): { anchored: number; missed: number } {
  const segsByIdx = new Map<number, TranscriptSegment[]>();
  for (const r of recordings) segsByIdx.set(r.index, r.segments || []);
  let anchored = 0;
  let missed = 0;

  for (const m of report.key_moments ?? []) {
    // Normalize label: lowercase, snake_case, strip non-[a-z0-9_], collapse
    // repeats, trim to 40 chars. Accepts whatever the LLM emitted (canonical
    // 9 OR a coined business-relevant label) and produces a consistent form.
    if (typeof m.label === "string") {
      m.label = m.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 40);
    }
    const segs = segsByIdx.get(m.recording_index);
    if (!segs) continue;
    const hit = findSegmentForQuote(segs, m.quote);
    if (hit) {
      m.start_ts_ms = hit.start_ms;
      m.end_ts_ms = Math.max(hit.end_ms, hit.start_ms);
      anchored++;
    } else {
      missed++;
    }
  }

  // patterns evidence — snap to nearest segment within 5s.
  for (const p of report.patterns ?? []) {
    for (const ev of p.evidence ?? []) {
      const segs = segsByIdx.get(ev.recording_index);
      if (!segs?.length) continue;
      let best = segs[0];
      let bestDist = Math.abs(best.start_ms - ev.start_ts_ms);
      for (let i = 1; i < segs.length; i++) {
        const d = Math.abs(segs[i].start_ms - ev.start_ts_ms);
        if (d < bestDist) {
          best = segs[i];
          bestDist = d;
        }
      }
      if (bestDist <= 5_000) ev.start_ts_ms = best.start_ms;
    }
  }

  return { anchored, missed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Materialize LLM-emitted rewrites into the persisted CallReport shape.
//
// The LLM emits: pair_id, client_said_excerpt, original_excerpt, rewrite,
// rationale, playbook_source.
//
// We resolve:
//   pair_id          → server-built (client_turn, closer_turn) adjacency
//   *_excerpt        → underlying AssemblyAI segment whose text contains it
//   timestamps       → segment.start_ms / segment.end_ms (never from LLM)
//
// Fallbacks:
//   - Invalid pair_id  → drop the rewrite (cannot recover).
//   - Excerpt doesn't match within turn → fall back to full turn text +
//     the turn's first segment (the rewrite stays, just less curated).
//
// Per-pair limit: each pair_id is honored at most twice (LLM may legitimately
// surface two distinct teachable moments in one closer turn).
// ─────────────────────────────────────────────────────────────────────────────
function materializeRewritesFromPairs(
  llmReport: LLMCallReport,
  pairsByPairId: Map<string, Pair>,
  segmentsByRec: Map<number, TranscriptSegment[]>,
): {
  rewrites: CallReport["rewrites"];
  dropped_invalid_pair: number;
  excerpt_fallback_closer: number;
  excerpt_fallback_client: number;
} {
  const out: CallReport["rewrites"] = [];
  let dropped_invalid_pair = 0;
  let excerpt_fallback_closer = 0;
  let excerpt_fallback_client = 0;
  const useCount = new Map<string, number>();

  for (const lr of llmReport.rewrites ?? []) {
    const pair = pairsByPairId.get(lr.pair_id);
    if (!pair) {
      dropped_invalid_pair++;
      continue;
    }
    const used = useCount.get(lr.pair_id) ?? 0;
    if (used >= 2) continue; // per-pair cap
    useCount.set(lr.pair_id, used + 1);

    const segs = segmentsByRec.get(pair.recording_index) ?? [];

    // Resolve closer side
    let closerSeg = resolveExcerptToSegment(
      pair.closer_turn,
      segs,
      lr.original_excerpt,
    );
    let originalText = lr.original_excerpt;
    if (!closerSeg) {
      // Fallback: use the turn's first segment + full turn text.
      closerSeg = segs[pair.closer_turn.segment_indices[0]] ?? null;
      originalText = pair.closer_turn.text;
      excerpt_fallback_closer++;
    }
    if (!closerSeg) continue; // truly unresolvable

    // Resolve client side
    let clientSeg = resolveExcerptToSegment(
      pair.client_turn,
      segs,
      lr.client_said_excerpt,
    );
    let clientText = lr.client_said_excerpt;
    if (!clientSeg) {
      clientSeg = segs[pair.client_turn.segment_indices[0]] ?? null;
      clientText = pair.client_turn.text;
      excerpt_fallback_client++;
    }

    const built: CallReport["rewrites"][number] = {
      recording_index: pair.recording_index,
      start_ts_ms: closerSeg.start_ms,
      original: originalText,
      rewrite: lr.rewrite,
      rationale: lr.rationale,
      playbook_source: lr.playbook_source,
    };
    if (clientSeg) {
      built.client_said = clientText;
      built.client_said_start_ts_ms = clientSeg.start_ms;
      built.client_said_end_ts_ms = clientSeg.end_ms;
    }
    out.push(built);
  }

  return {
    rewrites: out,
    dropped_invalid_pair,
    excerpt_fallback_closer,
    excerpt_fallback_client,
  };
}

const SYSTEM_PROMPT = `You are reading a sales call for Antano & Harini's Excellence Installations work — the CTD, BiG, FTM, uP, CPM, EI Solution, SMP journeys (some with Continuity or SLD CI). You are NOT a generic sales coach. You are the founder reading the call and naming what actually moved the prospect (or didn't).

Pick the lens, the moments, and the rubric keys that THIS specific call attempted. Do not default to the same picks across calls.

═══ TRANSCRIPT FORMAT ═══

The <call_transcripts> block uses merged conversation turns, NOT per-sentence segments. Each row is:

  Turn rX_tNNNN | ROLE [mm:ss-mm:ss] [pair=rX_tMMMM]: text

Where:
- \`rX_tNNNN\` is the turn id (unique within the call).
- \`ROLE\` is either \`CLIENT\` (the prospect) or \`CLOSER\` (the salesperson). The roles are pre-determined for you; you do NOT need to identify speakers.
- \`[mm:ss-mm:ss]\` is the time range the turn spans.
- \`pair=rX_tMMMM\` (only on some CLOSER turns) is the id of the CLIENT turn this closer turn immediately follows. Use it as the rewrite anchor (see HIGHER-LEVERAGE MOVES below).

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
3. **Quote verbatim.** Every \`quote\`, \`client_said_excerpt\`, and \`original_excerpt\` field must be exact substrings of the transcript. Never paraphrase.
4. **Citations are verbatim from the supplied playbook.** Every \`playbook_source\` MUST be one of the chunks supplied in \`<retrieved_reference_chunks>\` or \`<founder_videos>\`. Copy \`title\` and \`source_type\` verbatim from that chunk's metadata. For \`founder_video\` and \`reference_call\` sources, also copy \`start_ts_ms\` and \`end_ts_ms\` verbatim. For \`text_document\` sources, OMIT \`start_ts_ms\`/\`end_ts_ms\` entirely — they have no timestamps; do NOT invent them. NEVER invent a title or timestamp. Pick the chunk whose content most directly supports THIS specific rewrite. If no supplied chunk genuinely fits a rewrite, OMIT the rewrite entirely — do not force a citation.
5. **Founder voice.** Direct, present-tense, state-oriented. Sound like Antano or Harini reading this to the closer over coffee. NEVER use: "circle back", "value prop", "pain points", "buying signal", "objection handling", "rapport building", "active listening". These are corporate-sales-coach language and you are not that.
6. **Top-5 ranking is mandatory and call-type-relevant.** Exactly 5 entries, drawn from the pool matching \`call_type\`. Never reuse the same 5 across calls.
7. **deal_health is call-type aware.** Sale_closing: from state trajectory (yes from unshifted state = "weak"; no from someone who shifted = "mixed", not "weak"). Pre-sale: from whether curiosity was created and a real problem surfaced — absence of a commitment ask is NOT a failure. Sale_followup: from whether the relationship deepened and the next step was anchored.
8. **outcome is call-type aware.** "won" / "lost" apply ONLY to Sale_closing. For Pre-sale and Sale_followup, use "follow_up_needed" (success) or "stalled" / "unclear" (not). Never mark a Pre-sale "lost" because no money changed hands.
9. **TLDR is prose, 3–5 sentences.** Name the call type, what was installed, what was missed, where state moved or stalled. Sound like a founder, not a dashboard.
10. If the call has < 60 seconds of real dialogue, return a single key_moment labeled "risk" describing the data gap and minimal everything else. Do not invent.

═══ KEY MOMENTS ═══

State-layer moments, not logic-layer summaries. A key moment is where the prospect's state shifted, almost shifted, or refused to shift. \`what_happened\` is a state observation, not a transcript paraphrase. \`why_it_matters\` ties it to the installation craft (anchor / pacing / leading / certainty / silence / discovery / predictive intelligence).

For each key_moment, the \`quote\` must be a verbatim substring of a CLIENT or CLOSER turn's text. \`recording_index\` is the \`rX\` number from the turn id. \`start_ts_ms\` / \`end_ts_ms\` will be re-anchored server-side to the actual segment containing the quote, so don't agonize over them — but do supply your best estimate from the turn's time range.

\`label\` — **prefer one of these 9** (in order of how often they fit): \`state_shift\`, \`pacing_match\`, \`missed_anchor\`, \`installed_certainty\`, \`objection_time\`, \`objection_money\`, \`objection_doubt\`, \`commitment\`, \`risk\`. If — and only if — the moment is genuinely business-relevant and none of those 9 captures what happened, coin a short snake_case label of your own (e.g. \`predictive_intelligence\`, \`ecosystem_framing\`, \`state_choice\`, \`magic_words\`, \`silence_held\`). Do NOT coin a new label for novelty's sake. When in doubt, pick the closest of the 9.

═══ HIGHER-LEVERAGE MOVES (rewrites field) ═══

A rewrite is always anchored to a CLIENT → CLOSER pair. The transcript marks every coachable closer turn with \`pair=rX_tMMMM\` — that pair_id refers to the immediately preceding client turn.

For each rewrite (pick 4–6 total across the whole call):

- \`pair_id\` — copy verbatim from a \`pair=…\` annotation on a CLOSER turn in the transcript. You may ONLY reference pair_ids present in the transcript. Each pair_id may be used at most TWICE.
- \`client_said_excerpt\` — 1–2 sentences copied VERBATIM from the CLIENT turn of that pair. Pick the most charged / specific / coachable part of what the client actually said. If the client turn is short, copy it all. Do NOT paraphrase.
- \`original_excerpt\` — 1–2 sentences copied VERBATIM from the CLOSER turn of that pair — the actual line you want to rewrite. Do NOT paraphrase.
- \`rewrite\` — a founder-grade craft pointer. Name the metaphor, discovery question, predictive observation, ecosystem framing, or pattern. NOT a script, NOT dialogue. One or two short phrases: what tool, not what words.
- \`rationale\` — one or two lines: what the original did at logic layer, what the craft pointer does at state layer, why it fits this exact moment. Max 30 words.
- \`playbook_source\` — verbatim metadata of one supplied chunk that genuinely supports this move (see Hard Rule #4).

You do NOT emit timestamps, recording_index, speaker labels, or full quotes for rewrites. The server resolves all of that from your pair_id + excerpts.

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

// Internal preprocessing result — turns + pairs per recording, plus the
// flat pair lookup the materializer needs.
interface Preprocessed {
  turnsByRec: Map<number, Turn[]>;
  pairsByRec: Map<number, Pair[]>;
  pairsByPairId: Map<string, Pair>;
}

export function preprocess(args: AnalyzeCallArgs): Preprocessed {
  const turnsByRec = new Map<number, Turn[]>();
  const pairsByRec = new Map<number, Pair[]>();
  const pairsByPairId = new Map<string, Pair>();
  for (const r of args.recordings) {
    const merged = mergeIntoTurns(r.segments, r.index);
    const closer = detectCloserSpeaker(merged);
    labelTurns(merged, closer);
    const pairs = buildPairs(merged);
    turnsByRec.set(r.index, merged);
    pairsByRec.set(r.index, pairs);
    for (const p of pairs) pairsByPairId.set(p.pair_id, p);
  }
  return { turnsByRec, pairsByRec, pairsByPairId };
}

function trimFounderVideos(
  videos: AnalyzeCallArgs["playbook"]["founder_videos"],
): AnalyzeCallArgs["playbook"]["founder_videos"] {
  let remaining = FOUNDER_VIDEO_CHAR_CAP_TOTAL;
  return videos.map((v) => {
    if (remaining <= 0) return { title: v.title, full_text: "(truncated)" };
    const perCap = Math.min(FOUNDER_VIDEO_CHAR_CAP_PER, remaining);
    let text = v.full_text;
    if (text.length > perCap) {
      text = text.slice(0, perCap) + "\n…(truncated)";
    }
    remaining -= text.length;
    return { title: v.title, full_text: text };
  });
}

export function buildUserMessage(
  args: AnalyzeCallArgs,
  pre: Preprocessed,
): string {
  const meta = `<call_metadata>
  call_type: ${args.call.call_type}
  salesperson: ${args.call.salesperson_name}
  client: ${args.call.client_name}
</call_metadata>`;

  const transcripts = `<call_transcripts>
${args.recordings
  .map((r) => {
    const turns = pre.turnsByRec.get(r.index) ?? [];
    const pairs = pre.pairsByRec.get(r.index) ?? [];
    const body = renderTurns(turns, pairs)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n");
    return `  <recording index="${r.index}" duration_sec="${r.duration_sec ?? "unknown"}">\n${body}\n  </recording>`;
  })
  .join("\n")}
</call_transcripts>`;

  const trimmedVideos = trimFounderVideos(args.playbook.founder_videos);
  const founder = trimmedVideos
    .map(
      (s) =>
        `    <source title=${JSON.stringify(s.title)}>\n${s.full_text}\n    </source>`,
    )
    .join("\n");
  const refChunks = args.playbook.retrieved_reference_chunks
    .slice(0, REFERENCE_CHUNKS_CAP)
    .map((c) => {
      const ts =
        c.start_ts_ms != null && c.end_ts_ms != null
          ? ` start_ms="${c.start_ts_ms}" end_ms="${c.end_ts_ms}" range="${fmtTs(c.start_ts_ms)}–${fmtTs(c.end_ts_ms)}"`
          : "";
      return `    <chunk title=${JSON.stringify(c.title)} source_type="${c.source_type}"${ts}>\n${c.chunk_text}\n    </chunk>`;
    })
    .join("\n");

  const playbook = `<playbook>
  <founder_videos note="canon — truncated for token budget">
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
  const pre = preprocess(args);
  const userMessage = buildUserMessage(args, pre);
  const model = await getClaudeModel();

  const totalPairs = pre.pairsByPairId.size;
  console.log(
    `[analyze-call] preprocess: turns=${[...pre.turnsByRec.values()].reduce(
      (a, t) => a + t.length,
      0,
    )} pairs=${totalPairs}`,
  );

  // Strict-structure enforcement. The Anthropic API does NOT validate tool
  // input against input_schema, so we guarantee conformance ourselves:
  //   1. deterministic repair (deepParseJsonStrings) fixes stringified nested
  //      objects / arrays the model occasionally emits;
  //   2. on Zod failure we feed the EXACT validation errors back to the model
  //      via a tool_result and let it correct itself, up to MAX_ATTEMPTS.
  // A report that still fails after all attempts throws — it never reaches
  // the DB or UI in a malformed shape.
  const MAX_ATTEMPTS = 2;
  const messages: Array<{
    role: "user" | "assistant";
    content: unknown;
  }> = [{ role: "user", content: userMessage }];

  let parsedData: LLMCallReport | null = null;
  let input_tokens = 0;
  let output_tokens = 0;
  let lastIssues = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await callClaudeForReport({
      model,
      system: SYSTEM_PROMPT,
      messages,
    });
    input_tokens += res.input_tokens;
    output_tokens += res.output_tokens;

    // Layer 1: deterministic repair before validation.
    const repaired = deepParseJsonStrings(res.merged) as Record<
      string,
      unknown
    >;
    const parsed = LLMCallReportSchema.safeParse(repaired);
    if (parsed.success) {
      parsedData = parsed.data as LLMCallReport;
      if (attempt > 1) {
        console.log(`[analyze-call] recovered on retry attempt ${attempt}`);
      }
      break;
    }

    lastIssues = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join(" | ");
    console.warn(
      `[analyze-call] attempt ${attempt}/${MAX_ATTEMPTS} failed validation: ${lastIssues}`,
    );

    if (attempt === MAX_ATTEMPTS) break;

    // Layer 3: append the assistant's tool_use + a tool_result carrying the
    // validation errors, then ask for a corrected call. tool_choice stays
    // forced, so the next turn is another save_call_report.
    messages.push({ role: "assistant", content: res.rawContent });
    messages.push({
      role: "user",
      content: res.toolUseIds.map((id, idx) => ({
        type: "tool_result",
        tool_use_id: id,
        is_error: true,
        content:
          idx === 0
            ? `Your save_call_report input failed schema validation with these errors:\n${lastIssues}\n\nCall save_call_report again with the SAME analysis content but corrected structure. Emit every nested field as a real JSON object/array (never a JSON-encoded string). Supply all required fields. For text_document playbook_source citations, omit start_ts_ms/end_ts_ms.`
            : "Superseded — see the correction request on the first tool_result.",
      })),
    });
  }

  if (!parsedData) {
    throw new Error(
      `Claude returned malformed save_call_report input after ${MAX_ATTEMPTS} attempts. issues=[${lastIssues}]`,
    );
  }

  const segmentsByRec = new Map<number, TranscriptSegment[]>();
  for (const r of args.recordings) segmentsByRec.set(r.index, r.segments || []);

  // Materialize rewrites from pair_id + excerpts into the persisted shape.
  const mat = materializeRewritesFromPairs(
    parsedData,
    pre.pairsByPairId,
    segmentsByRec,
  );

  // Build the persisted report. Everything except rewrites passes through;
  // rewrites are the materialized list.
  const persisted: CallReport = {
    ...(parsedData as unknown as CallReport),
    rewrites: mat.rewrites,
  };

  const mp = anchorMomentsAndPatterns(persisted, args.recordings);

  // Final defense: validate the persisted shape end-to-end.
  const validated = CallReportSchema.safeParse(persisted);
  if (!validated.success) {
    const issues = validated.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join(" | ");
    throw new Error(
      `Materialized call report failed persistence schema. issues=[${issues}]`,
    );
  }

  console.log(
    `[analyze-call] rewrites kept=${mat.rewrites.length} dropped_invalid_pair=${mat.dropped_invalid_pair} closer_fallback=${mat.excerpt_fallback_closer} client_fallback=${mat.excerpt_fallback_client} moments_anchored=${mp.anchored}/${mp.anchored + mp.missed}`,
  );

  return {
    report: validated.data as CallReport,
    input_tokens,
    output_tokens,
    model,
    prompt_version: PROMPT_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: invoke Claude once for a save_call_report tool_use and return the
// merged input. Handles the parallel-tool-use case (some models split one
// logical save_call_report into multiple tool_use blocks).
// ─────────────────────────────────────────────────────────────────────────────
// Recursively parse any string that is actually a JSON object/array back into
// the real structure. The model occasionally serializes a nested field (e.g.
// `summary`, `rep_performance_rubric`, an array item) as a JSON-encoded string
// instead of emitting it inline. This deterministically repairs that before
// Zod validation, so the common malformed-shape case never needs a retry.
function deepParseJsonStrings(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === "string") {
    const s = value.trim();
    const looksJson =
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"));
    if (looksJson) {
      try {
        return deepParseJsonStrings(JSON.parse(s), depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepParseJsonStrings(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepParseJsonStrings(v, depth + 1);
    }
    return out;
  }
  return value;
}

async function callClaudeForReport(opts: {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
}): Promise<{
  merged: Record<string, unknown>;
  rawContent: unknown;
  toolUseIds: string[];
  input_tokens: number;
  output_tokens: number;
}> {
  const res = await anthropic().messages.create({
    model: opts.model,
    max_tokens: 16000,
    system: opts.system,
    tools: [CALL_REPORT_TOOL],
    tool_choice: { type: "tool", name: "save_call_report" },
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
        continue;
      } else {
        merged[k] = val;
      }
    }
  }

  return {
    merged,
    rawContent: res.content,
    toolUseIds: toolUses.map((t) => t.id),
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  };
}
