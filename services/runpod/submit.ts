// Submit an audio URL to the WhisperX RunPod Serverless endpoint.
//
// RunPod returns immediately with `{ id, status: "IN_QUEUE" }`. The job
// runs on a GPU worker (cold-start 5–10s with FlashBoot, then cached).
// When done, RunPod POSTs to the webhook URL we register here.
//
// Webhook auth: RunPod doesn't itself sign payloads. We pass our own
// per-request secret as a query param on the webhook URL; the callback
// route compares it constant-time against RunPod_Webhook_Secret.

import { runpodFetch } from "./client";

export interface SubmitRunPodInput {
  audioUrl: string;
  webhookUrl: string;
}

interface RunPodSubmitResponse {
  id: string;
  status: string;
}

export async function submitRunPodTranscription(
  input: SubmitRunPodInput,
): Promise<{ jobId: string }> {
  const res = await runpodFetch("/run", {
    method: "POST",
    body: JSON.stringify({
      input: {
        audio_url: input.audioUrl,
        // Handler args (consumed by infrastructure/runpod-whisperx/handler.py):
        // diarize=true → run pyannote diarization
        // language="en" → skip detection; English calls
        // task="transcribe" (not translate)
        // batch_size=32 → RTX 4090 has 24 GB VRAM, can handle larger batches
        diarize: true,
        language: "en",
        task: "transcribe",
        batch_size: 32,
      },
      webhook: input.webhookUrl,
    }),
  });
  const data = (await res.json()) as RunPodSubmitResponse;
  if (!data.id) {
    throw new Error(
      `RunPod /run returned no job id: ${JSON.stringify(data)}`,
    );
  }
  return { jobId: data.id };
}
