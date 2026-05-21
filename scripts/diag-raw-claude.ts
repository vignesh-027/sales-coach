// Reproduces the analyze-call request and dumps raw response content blocks
// + stop_reason so we can see where the "missing" output tokens go.
import { anthropic, getClaudeModel } from "../services/anthropic/client";
import { CALL_REPORT_TOOL } from "../services/anthropic/call-report-schema";
import { buildUserMessage } from "../services/anthropic/analyze-call";
import { getCall } from "../services/supabase/queries/calls";
import { listRecordings } from "../services/supabase/queries/call-recordings";
import { listCallTranscriptsOrdered } from "../services/supabase/queries/call-transcripts";
import {
  listKnowledgeItems,
  getKnowledgeItem,
} from "../services/supabase/queries/knowledge-items";
import { getTranscript } from "../services/supabase/queries/transcripts";
import { hybridSearchKnowledge } from "../services/supabase/queries/knowledge-chunks";
import { embedBatch } from "../services/voyage/embed";
import { rerank } from "../services/voyage/rerank";
import { buildSearchQuery } from "../services/voyage/build-search-query";

const SYSTEM_PROMPT = `You are reading a journey-closing call for Antano & Harini's Excellence Installations work. The journey programs you may see are BiG, FTM, uP, and BiG Continuity. The craft being graded is not generic sales — it is **state installation**: pacing the prospect's current state, leading them into a higher one, anchoring to a past breakthrough they themselves name, installing certainty before price is introduced, holding silence after price and after pivotal questions, and mirroring the prospect's pace and language.

Your report is read by the closer. It should sound like a close reading of the call — honest, specific, useful. Not a pep talk. Not a corporate sales-coaching dashboard.

Hard rules:
1. Quote only verbatim text from the call. Never paraphrase a "quote".
2. Every rewrite must cite a specific playbook chunk via the structured playbook_source object (title + source_type + timestamp range). If no playbook chunk supports a rewrite, omit it.
3. Score conservatively on the 1–5 rubric. 5 = matches the founder standard exactly. 1 = actively works against the playbook. Default to 3 when uncertain.
4. Caps: at most 8 key_moments, 6 rewrites, 5 patterns. Prefer fewer, higher-confidence items.
5. If the call has < 60 seconds of real dialogue, return a single key_moment with label "risk" describing the data gap and otherwise minimal output. Do not invent.

Always call the save_call_report tool with the full structured report. Do not respond in plain text.`;

const callId = process.argv[2];

(async () => {
  const call = await getCall(callId);
  if (!call) throw new Error("call not found");
  const [recordings, transcripts] = await Promise.all([
    listRecordings(callId),
    listCallTranscriptsOrdered(callId),
  ]);
  const recordingsForPrompt = transcripts.map((t) => {
    const r = recordings.find((x) => x.id === t.call_recording_id);
    return {
      index: t.recording_index,
      duration_sec: r?.duration_sec ?? null,
      full_text: t.full_text,
      segments: t.segments,
    };
  });
  const items = await listKnowledgeItems();
  const founderItems = items.filter(
    (i) => i.process_status === "done" && i.kind === "founder_video",
  );
  const founderVideos = (
    await Promise.all(
      founderItems.map(async (i) => {
        const t = await getTranscript(i.id);
        return t ? { title: i.title, full_text: t.full_text } : null;
      }),
    )
  ).flatMap((s) => (s ? [s] : []));

  const { embeddingText, ftsText } = buildSearchQuery(
    recordingsForPrompt.map((r) => r.full_text).join("\n\n"),
  );
  const [queryVec] = await embedBatch([embeddingText], {
    inputType: "query",
    scope: "diag",
    scopeId: callId,
  });
  const hits = await hybridSearchKnowledge(queryVec, ftsText, 50, [
    "reference_call",
    "text_document",
  ]);
  const reranked = await rerank(
    ftsText,
    hits.map((h) => h.chunk_text),
    { model: "rerank-2.5-lite", topK: 10, scope: "diag", scopeId: callId },
  );
  const retrievedReferenceChunks = await Promise.all(
    reranked.hits.map(async (rh) => {
      const h = hits[rh.index];
      const item = await getKnowledgeItem(h.knowledge_item_id);
      return {
        title: item?.title ?? "(unknown)",
        source_type:
          (item?.kind === "text_document"
            ? "text_document"
            : "reference_call") as "reference_call" | "text_document",
        start_ts_ms: h.start_ts_ms,
        end_ts_ms: h.end_ts_ms,
        chunk_text: h.chunk_text,
      };
    }),
  );

  const userMessage = buildUserMessage({
    call: {
      call_type: call.call_type,
      client_name: call.client_name,
      salesperson_name: call.salesperson_name,
    },
    recordings: recordingsForPrompt,
    playbook: { founder_videos: founderVideos, retrieved_reference_chunks: retrievedReferenceChunks },
  });

  const model = process.env.DIAG_MODEL ?? (await getClaudeModel());
  console.log("model:", model);
  console.log("user_msg_chars:", userMessage.length);

  const res = await anthropic().messages.create({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [CALL_REPORT_TOOL],
    tool_choice: { type: "tool", name: "save_call_report" },
    messages: [{ role: "user", content: userMessage }],
  });

  console.log("\n=== RAW RESPONSE ===");
  console.log("stop_reason:", res.stop_reason);
  console.log("usage:", res.usage);
  console.log("content blocks:", res.content.length);
  for (let i = 0; i < res.content.length; i++) {
    const b = res.content[i];
    console.log(`\n--- block[${i}] type=${b.type} ---`);
    if (b.type === "text") {
      console.log("text len:", b.text.length);
      console.log("first 500:", b.text.slice(0, 500));
      console.log("last 500:", b.text.slice(-500));
    } else if (b.type === "tool_use") {
      const input = b.input as Record<string, unknown>;
      console.log("tool name:", b.name);
      console.log("tool input keys:", Object.keys(input));
      console.log(
        "tool input sizes:",
        Object.fromEntries(
          Object.entries(input).map(([k, v]) => [
            k,
            Array.isArray(v) ? `array(${v.length})` : typeof v,
          ]),
        ),
      );
      console.log("tool input full:", JSON.stringify(input, null, 2).slice(0, 2000));
    } else {
      console.log("other block:", JSON.stringify(b).slice(0, 500));
    }
  }
})();
