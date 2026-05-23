export type CallOutcome =
  | "won"
  | "lost"
  | "follow_up_needed"
  | "stalled"
  | "unclear";

export type DealHealth = "strong" | "mixed" | "weak";

export type RubricScore = 1 | 2 | 3 | 4 | 5;

export type RubricAxis =
  | "pacing_quality"
  | "state_leading"
  | "anchoring_to_breakthrough"
  | "certainty_before_close"
  | "silence_handling";

export const RUBRIC_AXES: RubricAxis[] = [
  "pacing_quality",
  "state_leading",
  "anchoring_to_breakthrough",
  "certainty_before_close",
  "silence_handling",
];

export type MomentLabel =
  | "state_shift"
  | "pacing_match"
  | "missed_anchor"
  | "installed_certainty"
  | "objection_time"
  | "objection_money"
  | "objection_doubt"
  | "commitment"
  | "risk";

export const MOMENT_LABELS: MomentLabel[] = [
  "state_shift",
  "pacing_match",
  "missed_anchor",
  "installed_certainty",
  "objection_time",
  "objection_money",
  "objection_doubt",
  "commitment",
  "risk",
];

export type PlaybookSourceType =
  | "founder_video"
  | "reference_call"
  | "text_document";

export interface PlaybookCitation {
  title: string;
  source_type: PlaybookSourceType;
  start_ts_ms: number;
  end_ts_ms: number;
}

export type CallType = "Pre-sale" | "Sale_followup" | "Sale_closing";

export interface CallReport {
  call_type?: CallType;
  summary: {
    tldr: string;
    outcome: CallOutcome;
    deal_health: DealHealth;
    rep_performance_rubric: Record<RubricAxis, RubricScore>;
    duration_minutes_total: number;
  };
  key_moments: Array<{
    recording_index: number;
    start_ts_ms: number;
    end_ts_ms: number;
    label: MomentLabel;
    quote: string;
    what_happened: string;
    why_it_matters: string;
  }>;
  rewrites: Array<{
    recording_index: number;
    start_ts_ms: number;
    client_said: string;
    original: string;
    rewrite: string;
    rationale: string;
    playbook_source: PlaybookCitation;
  }>;
  patterns: Array<{
    name: string;
    description: string;
    evidence: Array<{ recording_index: number; start_ts_ms: number }>;
    playbook_alignment: string;
  }>;
}

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Runtime validator (Zod) — mirrors CALL_REPORT_TOOL.input_schema.
//
// The Anthropic API does NOT validate tool_use input against the tool schema;
// it returns whatever the model produced. Postgres jsonb stores any shape.
// So without a runtime check, a malformed report (e.g. key_moments as a
// JSON-encoded STRING instead of an array, missing fields, wrong enums) can
// propagate all the way to the UI and crash it.
//
// This validator is the single enforcement point. runAnalysis() parses through
// it before returning, and upsertCallReport() parses again before writing —
// belt + suspenders.
//
// Any change to CALL_REPORT_TOOL must be reflected here, and vice versa.
// ─────────────────────────────────────────────────────────────────────────────

// All citation fields are strict: the prompt requires the model to copy
// title / source_type / start_ts_ms / end_ts_ms verbatim from a supplied
// playbook chunk's metadata. Nothing to invent, nothing to omit. If no
// supplied chunk fits a rewrite, the rewrite is omitted entirely.
const PlaybookCitationSchema = z.object({
  title: z.string(),
  source_type: z.enum(["founder_video", "reference_call", "text_document"]),
  start_ts_ms: z.number().int().min(0),
  end_ts_ms: z.number().int().min(0),
});

const KeyMomentLabelSchema = z.enum([
  "state_shift",
  "pacing_match",
  "missed_anchor",
  "installed_certainty",
  "objection_time",
  "objection_money",
  "objection_doubt",
  "commitment",
  "risk",
]);

export const CallReportSchema = z.object({
  // call_type added in PROMPT_VERSION 6. Optional so older reports
  // (stored before v6) still validate when re-rendered.
  call_type: z
    .enum(["Pre-sale", "Sale_followup", "Sale_closing"])
    .optional(),
  summary: z.object({
    tldr: z.string().min(1),
    outcome: z.enum(["won", "lost", "follow_up_needed", "stalled", "unclear"]),
    deal_health: z.enum(["strong", "mixed", "weak"]),
    rep_performance_rubric: z
      .record(z.string(), z.number().int().min(1).max(5))
      .refine((r) => Object.keys(r).length === 5, {
        message: "rep_performance_rubric must have exactly 5 entries",
      }),
    duration_minutes_total: z.number(),
  }),
  key_moments: z
    .array(
      z.object({
        recording_index: z.number().int().min(0),
        start_ts_ms: z.number().int().min(0),
        end_ts_ms: z.number().int().min(0),
        label: KeyMomentLabelSchema,
        quote: z.string(),
        what_happened: z.string(),
        why_it_matters: z.string(),
      }),
    )
    .max(8),
  rewrites: z
    .array(
      z.object({
        recording_index: z.number().int().min(0),
        start_ts_ms: z.number().int().min(0),
        client_said: z.string(),
        original: z.string(),
        rewrite: z.string(),
        rationale: z.string(),
        playbook_source: PlaybookCitationSchema,
      }),
    )
    .max(6),
  patterns: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        evidence: z.array(
          z.object({
            recording_index: z.number().int().min(0),
            start_ts_ms: z.number().int().min(0),
          }),
        ),
        playbook_alignment: z.string(),
      }),
    )
    .max(5),
});

export type CallReportValidated = z.infer<typeof CallReportSchema>;


export const CALL_REPORT_TOOL: Anthropic.Tool = {
  name: "save_call_report",
  description:
    "Save the structured sales-call analysis report. Always call this tool exactly once with the full report, including the call_type classification (Pre-sale, Sale_followup, or Sale_closing).",
  input_schema: {
    type: "object",
    required: ["summary", "key_moments", "rewrites", "patterns"],
    properties: {
      call_type: {
        type: "string",
        enum: ["Pre-sale", "Sale_followup", "Sale_closing"],
        description:
          "Classification of this call's place in the journey. Pre-sale = discovery/opening (no commitment ask expected). Sale_followup = middle relationship-deepening call (sets up next call, no close). Sale_closing = the journey-closing call where the state shift and commitment land. Set this BEFORE picking the top-5 rubric keys — the top-5 must be appropriate to this type.",
      },
      summary: {
        type: "object",
        required: [
          "tldr",
          "outcome",
          "deal_health",
          "rep_performance_rubric",
          "duration_minutes_total",
        ],
        properties: {
          tldr: {
            type: "string",
            description:
              "One paragraph (3–5 sentences) reading the call like prose. Name what was installed, what was missed, where state shifted.",
          },
          outcome: {
            type: "string",
            enum: ["won", "lost", "follow_up_needed", "stalled", "unclear"],
          },
          deal_health: {
            type: "string",
            enum: ["strong", "mixed", "weak"],
            description:
              "Derive from state trajectory, not stated buying signals. A prospect who said yes but never shifted state is 'weak'.",
          },
          rep_performance_rubric: {
            type: "object",
            description:
              "Top 5 things this call actually attempted, each scored 1–5. Keys are short lowercase phrases naming the move (e.g. 'anchoring to her own words', 'sealing the shift', 'predictive intelligence', 'state choice at conversion', 'pacing and rapport'). Must contain exactly 5 entries. Pick what THIS call attempted — do not reuse the same 5 keys across calls.",
            minProperties: 5,
            maxProperties: 5,
            additionalProperties: {
              type: "integer",
              minimum: 1,
              maximum: 5,
            },
          },
          duration_minutes_total: { type: "number" },
        },
      },
      key_moments: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          required: [
            "recording_index",
            "start_ts_ms",
            "end_ts_ms",
            "label",
            "quote",
            "what_happened",
            "why_it_matters",
          ],
          properties: {
            recording_index: { type: "integer", minimum: 0 },
            start_ts_ms: { type: "integer", minimum: 0 },
            end_ts_ms: { type: "integer", minimum: 0 },
            label: {
              type: "string",
              enum: [
                "state_shift",
                "pacing_match",
                "missed_anchor",
                "installed_certainty",
                "objection_time",
                "objection_money",
                "objection_doubt",
                "commitment",
                "risk",
              ],
            },
            quote: {
              type: "string",
              description: "Verbatim text from the call, ≤200 chars.",
            },
            what_happened: {
              type: "string",
              description:
                "One sentence — a state-layer observation, not a logic-layer summary.",
            },
            why_it_matters: {
              type: "string",
              description:
                "One sentence tying this moment to the installation craft (pacing, leading, anchoring, certainty, silence).",
            },
          },
        },
      },
      rewrites: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          required: [
            "recording_index",
            "start_ts_ms",
            "client_said",
            "original",
            "rewrite",
            "rationale",
            "playbook_source",
          ],
          properties: {
            recording_index: { type: "integer", minimum: 0 },
            start_ts_ms: { type: "integer", minimum: 0 },
            client_said: {
              type: "string",
              description:
                "Verbatim words the prospect spoke that the closer was responding to. Must come from the same recording within ~15s before start_ts_ms. If no clearly attributable prospect line exists, omit this rewrite entirely.",
            },
            original: {
              type: "string",
              description: "Verbatim line the closer said.",
            },
            rewrite: {
              type: "string",
              description:
                "Replacement line in founder voice (Antano/Harini cadence). Not corporate sales-coaching cliché.",
            },
            rationale: {
              type: "string",
              description:
                "One sentence: what the original did at the logic layer, what the craft pointer does at the state layer, and why it fits this exact moment in the prospect's state. Max 30 words.",
            },
            playbook_source: {
              type: "object",
              required: ["title", "source_type", "start_ts_ms", "end_ts_ms"],
              description:
                "Citation to a real chunk from the supplied playbook. Required. Omit the rewrite if no playbook material supports it.",
              properties: {
                title: { type: "string" },
                source_type: {
                  type: "string",
                  enum: ["founder_video", "reference_call", "text_document"],
                },
                start_ts_ms: { type: "integer", minimum: 0 },
                end_ts_ms: { type: "integer", minimum: 0 },
              },
            },
          },
        },
      },
      patterns: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          required: ["name", "description", "evidence", "playbook_alignment"],
          properties: {
            name: { type: "string" },
            description: {
              type: "string",
              description:
                "A cross-call observation about this closer's installation craft — not an in-call moment.",
            },
            evidence: {
              type: "array",
              items: {
                type: "object",
                required: ["recording_index", "start_ts_ms"],
                properties: {
                  recording_index: { type: "integer", minimum: 0 },
                  start_ts_ms: { type: "integer", minimum: 0 },
                },
              },
            },
            playbook_alignment: {
              type: "string",
              description:
                "How this pattern relates to the founder playbook — aligned, drifting, or against.",
            },
          },
        },
      },
    },
  },
};
