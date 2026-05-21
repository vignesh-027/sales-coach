/**
 * One-shot AssemblyAI probe. Verifies whether `language_detection +
 * code_switching` on `universal-2` returns native-script Tamil/Hindi
 * inside a code-switched utterance, or romanized text.
 *
 * Usage:
 *   AAI_PROBE_URL=https://example.com/sample.mp3 \
 *     npx tsx --env-file=.env.local scripts/assemblyai-multilingual-probe.ts
 *
 * The sample audio must be publicly downloadable by AssemblyAI. Drop a short
 * (~30s) clip of Tamil/Hindi mixed with English into R2 first, then pass the
 * signed URL via AAI_PROBE_URL.
 *
 * Delete this script after the result is captured in the PR description.
 */
import { aaiFetch } from "../services/assemblyai/client";

const url = process.env.AAI_PROBE_URL;
if (!url) {
  console.error("Set AAI_PROBE_URL to a publicly fetchable audio URL.");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("[probe] submitting", url);
  const submitRes = await aaiFetch("/transcript", {
    method: "POST",
    body: JSON.stringify({
      audio_url: url,
      speech_models: ["universal-2"],
      speaker_labels: true,
      language_detection: true,
      language_detection_options: { code_switching: true },
    }),
  });
  const submitted = (await submitRes.json()) as { id: string };
  console.log("[probe] transcript id:", submitted.id);

  // Poll instead of using the webhook so the script stays self-contained.
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    await new Promise((r) => setTimeout(r, 4000));
    const pollRes = await aaiFetch(`/transcript/${submitted.id}`, {});
    const tr = (await pollRes.json()) as {
      status: string;
      text?: string;
      utterances?: unknown[];
      language_detection_results?: unknown;
      error?: string;
    };
    console.log(`[probe] attempt ${attempt} status=${tr.status}`);
    if (tr.status === "completed") {
      console.log("\n--- text ---");
      console.log(tr.text);
      console.log("\n--- utterances (first 5) ---");
      console.log(JSON.stringify(tr.utterances?.slice(0, 5) ?? [], null, 2));
      console.log("\n--- language_detection_results ---");
      console.log(JSON.stringify(tr.language_detection_results ?? null, null, 2));
      return;
    }
    if (tr.status === "error") {
      throw new Error(`assemblyai error: ${tr.error ?? "(no message)"}`);
    }
    if (attempt > 60) {
      throw new Error("timed out waiting for transcript");
    }
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
