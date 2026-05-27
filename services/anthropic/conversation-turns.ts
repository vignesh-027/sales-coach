/**
 * Conversation turn merging + adjacent-pair indexing.
 *
 * The LLM should not be asked to guess speaker identity, pair adjacent turns,
 * or emit timestamps — those are mechanical operations the transcript already
 * encodes. This module collapses AssemblyAI's per-sentence segments into
 * logical "turns" (consecutive same-speaker segments), labels each turn as
 * CLIENT or CLOSER, and exposes an adjacency index so the analyzer can let the
 * LLM pick rewrites by `pair_id` only.
 *
 * Pure / deterministic / no external calls. Run fresh per analyze.
 */
import type { TranscriptSegment } from "@/services/supabase/queries/transcripts";

export type Role = "CLIENT" | "CLOSER";

export interface Turn {
  turn_id: string;            // e.g. "r0_t0042"
  recording_index: number;
  speaker: string;            // raw AssemblyAI label (A/B/C…)
  role: Role;
  start_ms: number;
  end_ms: number;
  text: string;               // concatenated text of merged segments
  segment_indices: number[];  // positions into the original segments[] array
}

export interface Pair {
  pair_id: string;            // == client_turn.turn_id
  recording_index: number;
  client_turn: Turn;
  closer_turn: Turn;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text normalization for substring matching (LLM excerpts vs. turn text).
// Strips punctuation, collapses whitespace, lowercases, normalizes quotes.
// Same as the matcher used previously in analyze-call.ts; centralized here.
// ─────────────────────────────────────────────────────────────────────────────
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(s: string): number {
  const n = norm(s);
  if (!n) return 0;
  return n.split(" ").length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge consecutive same-speaker segments into logical turns.
//
// Rules:
//   1. Speaker change ends a turn.
//   2. A gap > GAP_THRESHOLD_MS between segments ends a turn even if the
//      speaker is the same (handles "speaker pauses, the other person speaks,
//      first speaker comes back" — those should be two separate turns, not
//      glued).
//
// GAP_THRESHOLD_MS = 8000ms: comfortably above conversational pauses (~2-4s)
// but below "they're now talking about something else" (~15s+).
// ─────────────────────────────────────────────────────────────────────────────
const GAP_THRESHOLD_MS = 8000;

export function mergeIntoTurns(
  segments: TranscriptSegment[],
  recording_index: number,
): Turn[] {
  if (!segments?.length) return [];
  const turns: Turn[] = [];
  let cur: Turn | null = null;

  segments.forEach((s, i) => {
    const sameSpeaker = cur && cur.speaker === s.speaker;
    const smallGap = cur && s.start_ms - cur.end_ms <= GAP_THRESHOLD_MS;
    if (cur && sameSpeaker && smallGap) {
      cur.text = cur.text + " " + s.text.trim();
      cur.end_ms = s.end_ms;
      cur.segment_indices.push(i);
      return;
    }
    if (cur) turns.push(cur);
    cur = {
      turn_id: `r${recording_index}_t${turns.length.toString().padStart(4, "0")}`,
      recording_index,
      speaker: s.speaker,
      role: "CLIENT", // placeholder, set by labelTurns()
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      text: s.text.trim(),
      segment_indices: [i],
    };
  });
  if (cur) turns.push(cur);
  return turns;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detect the closer's speaker label per recording.
//
// Heuristic: total speaking time (airtime). The salesperson typically holds
// the floor longer in any non-trivial sales call — explaining, framing,
// pitching. Tie-break on turn count (more turns = more active speaker).
//
// If only one speaker is present, return that speaker (degenerate case;
// pairs will be empty and no rewrites will be generated).
// ─────────────────────────────────────────────────────────────────────────────
export function detectCloserSpeaker(turns: Turn[]): string | null {
  if (!turns?.length) return null;
  const airtime = new Map<string, number>();
  const count = new Map<string, number>();
  for (const t of turns) {
    airtime.set(t.speaker, (airtime.get(t.speaker) ?? 0) + (t.end_ms - t.start_ms));
    count.set(t.speaker, (count.get(t.speaker) ?? 0) + 1);
  }
  const speakers = [...airtime.keys()];
  if (speakers.length === 1) return speakers[0];
  speakers.sort((a, b) => {
    const da = (airtime.get(b) ?? 0) - (airtime.get(a) ?? 0);
    if (da !== 0) return da;
    return (count.get(b) ?? 0) - (count.get(a) ?? 0);
  });
  return speakers[0] ?? null;
}

export function labelTurns(turns: Turn[], closerSpeaker: string | null): Turn[] {
  for (const t of turns) {
    t.role = closerSpeaker && t.speaker === closerSpeaker ? "CLOSER" : "CLIENT";
  }
  return turns;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the adjacency index: every (CLIENT → CLOSER) pair where both turns
// have enough content to be coachable. Closer turn gets `pair_id` annotation
// equal to the preceding client turn's `turn_id`.
//
// Trivial-turn filter: drop pairs where either side is < MIN_WORDS_FOR_PAIR.
// Backchannels ("yeah", "okay", "mm-hmm") are not coachable moments.
// ─────────────────────────────────────────────────────────────────────────────
const MIN_WORDS_FOR_PAIR = 4;

export function buildPairs(turns: Turn[]): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 1; i < turns.length; i++) {
    const prev = turns[i - 1];
    const curr = turns[i];
    if (prev.role !== "CLIENT" || curr.role !== "CLOSER") continue;
    if (wordCount(prev.text) < MIN_WORDS_FOR_PAIR) continue;
    if (wordCount(curr.text) < MIN_WORDS_FOR_PAIR) continue;
    pairs.push({
      pair_id: prev.turn_id,
      recording_index: prev.recording_index,
      client_turn: prev,
      closer_turn: curr,
    });
  }
  return pairs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve an LLM-emitted excerpt back to the underlying AssemblyAI segment
// inside a turn. Used after the LLM picks a rewrite — we need the real
// start_ms / end_ms for the audio jump.
//
// Strategy:
//   1. Substring match excerpt against each segment in `turn.segment_indices`.
//   2. Multi-segment window match (excerpt spans 2-4 segments).
//   3. Prefix match (first 60 chars).
//   4. Fallback: return the first segment of the turn (audio jumps to turn
//      start). The caller decides whether to use this or drop the rewrite.
// ─────────────────────────────────────────────────────────────────────────────
export function resolveExcerptToSegment(
  turn: Turn,
  allSegments: TranscriptSegment[],
  excerpt: string,
): TranscriptSegment | null {
  if (!excerpt || !turn?.segment_indices?.length) return null;
  const ex = norm(excerpt);
  if (ex.length < 6) return null;
  const segs = turn.segment_indices.map((i) => allSegments[i]).filter(Boolean);

  // 1. exact substring
  for (const s of segs) {
    if (norm(s.text).includes(ex)) return s;
  }
  // 2. window match (up to 4 segments)
  for (let i = 0; i < segs.length; i++) {
    let acc = "";
    for (let j = i; j < Math.min(i + 4, segs.length); j++) {
      acc = acc ? acc + " " + norm(segs[j].text) : norm(segs[j].text);
      if (acc.includes(ex)) return segs[i];
    }
  }
  // 3. prefix match
  const head = ex.slice(0, 60);
  if (head.length >= 12) {
    for (const s of segs) {
      if (norm(s.text).includes(head)) return s;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render the merged turn list for the LLM prompt. One row per turn. Closer
// turns that have a preceding-CLIENT pair are annotated with `pair=tNNN`.
//
// Format:
//   Turn r0_t0014 | CLIENT [00:48-01:02]: I checked the calendar...
//   Turn r0_t0015 | CLOSER [01:02-01:14] pair=r0_t0014: It happens in Mumbai...
//
// One timestamp range per turn (not per segment) — significant token savings
// vs the old segment-by-segment rendering.
// ─────────────────────────────────────────────────────────────────────────────
function fmtTs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

export function renderTurns(turns: Turn[], pairs: Pair[]): string {
  if (!turns?.length) return "(no turns)";
  const pairByCloserTurnId = new Map<string, string>();
  for (const p of pairs) {
    pairByCloserTurnId.set(p.closer_turn.turn_id, p.pair_id);
  }
  return turns
    .map((t) => {
      const ts = `[${fmtTs(t.start_ms)}-${fmtTs(t.end_ms)}]`;
      const pairAnno =
        t.role === "CLOSER" && pairByCloserTurnId.has(t.turn_id)
          ? ` pair=${pairByCloserTurnId.get(t.turn_id)}`
          : "";
      return `Turn ${t.turn_id} | ${t.role} ${ts}${pairAnno}: ${t.text}`;
    })
    .join("\n");
}
