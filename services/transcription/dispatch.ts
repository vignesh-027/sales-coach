// Provider-agnostic transcription submission.
//
// Workers (`ingest-call-recording`, `ingest-knowledge`) call
// submitTranscription() instead of importing an AAI helper directly. We read
// the active model from app_settings, look it up in TRANSCRIPTION_OPTIONS,
// and dispatch to the matching provider's submit helper.
//
// The dispatcher appends `?provider=<assemblyai|runpod>` to the webhook URL
// at submit time so the callback route knows which verifier and finalizer
// to run without sniffing the body.

import { getAppSettings } from "@/services/supabase/queries/app-settings";
import {
  submitTranscription as submitAaiTranscription,
  type AaiSpeechModel,
} from "@/services/assemblyai/transcribe";
import { submitRunPodTranscription } from "@/services/runpod/submit";
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  findTranscriptionOption,
  type TranscriptionProvider,
} from "./models";
import type { SubmitResult } from "./types";

export interface DispatchInput {
  audioUrl: string;
  /**
   * Webhook URL without a `?provider=` query string — the dispatcher
   * appends one based on the chosen provider so the callback route can
   * verify with the right secret.
   */
  webhookUrl: string;
  /**
   * Used only by the AAI path (per-recording rotating header secret). The
   * RunPod path uses a single endpoint-wide secret from env.
   */
  webhookSecret: string;
}

export interface DispatchOutput extends SubmitResult {
  /** The full transcription-model id (e.g. "assemblyai/universal-2"). */
  modelId: string;
}

function appendProvider(url: string, provider: TranscriptionProvider): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}provider=${provider}`;
}

export async function submitTranscription(
  input: DispatchInput,
): Promise<DispatchOutput> {
  const settings = await getAppSettings();
  const modelId = settings.transcription_model || DEFAULT_TRANSCRIPTION_MODEL;
  const opt = findTranscriptionOption(modelId);
  if (!opt) {
    throw new Error(
      `transcription_model "${modelId}" not in allow-list — settings out of sync with code`,
    );
  }

  if (opt.provider === "assemblyai") {
    const { transcriptId } = await submitAaiTranscription({
      audioUrl: input.audioUrl,
      model: opt.model as AaiSpeechModel,
      webhookUrl: appendProvider(input.webhookUrl, "assemblyai"),
      webhookSecret: input.webhookSecret,
    });
    return { provider: "assemblyai", providerId: transcriptId, modelId };
  }

  if (opt.provider === "runpod") {
    const runpodSecret = process.env.RunPod_Webhook_Secret;
    if (!runpodSecret) {
      throw new Error("Missing RunPod_Webhook_Secret — required to submit");
    }
    // RunPod doesn't sign payloads, so we put a shared secret on the
    // webhook URL. The callback route extracts and constant-time compares
    // it via services/runpod/verify-webhook.ts.
    const urlWithProvider = appendProvider(input.webhookUrl, "runpod");
    const sep = urlWithProvider.includes("?") ? "&" : "?";
    const webhookUrl = `${urlWithProvider}${sep}secret=${encodeURIComponent(runpodSecret)}`;
    const { jobId } = await submitRunPodTranscription({
      audioUrl: input.audioUrl,
      webhookUrl,
    });
    return { provider: "runpod", providerId: jobId, modelId };
  }

  throw new Error(`unsupported provider for ${modelId}`);
}
