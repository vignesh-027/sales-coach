import { aaiFetch } from "./client";

export const WEBHOOK_HEADER_NAME = "x-aai-secret";

export async function submitTranscription(input: {
  audioUrl: string;
  webhookUrl: string;
  webhookSecret: string;
}): Promise<{ transcriptId: string }> {
  const res = await aaiFetch("/transcript", {
    method: "POST",
    body: JSON.stringify({
      audio_url: input.audioUrl,
      speech_models: ["universal-2"],
      speaker_labels: true,
      // Multilingual support: handle mixed-language utterances (e.g. Tamil/
      // Hindi/English code-switching) across AssemblyAI's 99 supported
      // languages. No price change vs. plain `universal-2`. The response
      // surfaces `language_detection_results.code_switching_languages`
      // which downstream consumers can log if needed.
      language_detection: true,
      language_detection_options: {
        code_switching: true,
      },
      webhook_url: input.webhookUrl,
      webhook_auth_header_name: WEBHOOK_HEADER_NAME,
      webhook_auth_header_value: input.webhookSecret,
    }),
  });
  const data = (await res.json()) as { id: string };
  return { transcriptId: data.id };
}
