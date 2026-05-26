import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/app/_components/current-user";
import { getAppSettings } from "@/services/supabase/queries/app-settings";
import {
  LLM_OPTIONS,
  DEFAULT_LLM_MODEL,
} from "@/services/anthropic/models";
import {
  RERANK_OPTIONS,
  DEFAULT_RERANK_MODEL,
} from "@/services/voyage/rerank-models";
import {
  TRANSCRIPTION_OPTIONS,
  DEFAULT_TRANSCRIPTION_MODEL,
} from "@/services/transcription/models";
import {
  VOYAGE_EMBEDDING_MODEL,
  VOYAGE_EMBEDDING_DIM,
} from "@/services/voyage/client";
import { ConfigurationClient } from "./configuration-client";

export default async function ConfigurationPage() {
  const me = await getCurrentAppUser();
  if (!me.is_admin) redirect("/calls");
  const settings = await getAppSettings().catch(() => ({
    llm_model: DEFAULT_LLM_MODEL,
    rerank_model: DEFAULT_RERANK_MODEL,
    transcription_model: DEFAULT_TRANSCRIPTION_MODEL,
    updated_at: new Date().toISOString(),
    updated_by: null as string | null,
  }));
  return (
    <ConfigurationClient
      initialLlmModel={settings.llm_model}
      initialRerankModel={settings.rerank_model}
      initialTranscriptionModel={
        settings.transcription_model ?? DEFAULT_TRANSCRIPTION_MODEL
      }
      llmOptions={LLM_OPTIONS.map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        tier: o.tier,
        cost_per_mtok_input: o.cost_per_mtok_input,
        cost_per_mtok_output: o.cost_per_mtok_output,
      }))}
      rerankOptions={RERANK_OPTIONS.map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        tier: o.tier,
        cost_per_mtok: o.cost_per_mtok,
      }))}
      transcriptionOptions={TRANSCRIPTION_OPTIONS.map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        provider: o.provider,
        tier: o.tier,
        cost_per_hr_audio: o.cost_per_hr_audio,
      }))}
      embedding={{
        provider: "Voyage AI",
        model: VOYAGE_EMBEDDING_MODEL,
        dim: VOYAGE_EMBEDDING_DIM,
        notes: "1024-d · multilingual · paid",
      }}
    />
  );
}
