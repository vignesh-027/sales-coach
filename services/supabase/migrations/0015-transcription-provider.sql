-- Slice: configurable transcription provider.
--
-- Until now, transcription was hardcoded to AssemblyAI universal-2 inside
-- services/assemblyai/transcribe.ts. We now expose a provider/model
-- selection through app_settings so admins can compare AssemblyAI
-- (Universal-2 / Universal-3 Pro) against self-hosted WhisperX on RunPod
-- Serverless.
--
-- The allow-list of values is enforced in app code (matching the existing
-- llm_model / rerank_model pattern in services/transcription/models.ts):
--   - assemblyai/universal-2     (default; identical to current behaviour)
--   - assemblyai/universal-3-pro
--   - runpod/whisperx-turbo
--
-- We keep the legacy `assemblyai_transcript_id` columns for backward
-- compatibility (existing rows already point at AAI transcripts). New
-- columns capture the RunPod job id and the chosen provider so the webhook
-- router and finalize() helper can pick the right fetcher.

alter table app_settings
  add column if not exists transcription_model text not null
    default 'assemblyai/universal-2';

alter table call_recordings
  add column if not exists runpod_job_id text unique,
  add column if not exists transcription_provider text;

alter table knowledge_items
  add column if not exists runpod_job_id text unique,
  add column if not exists transcription_provider text;

-- Allow 'runpod' as a model_usage provider. The existing CHECK constraint
-- (added in 0014) only lists voyage/anthropic/assemblyai; we widen it.
alter table model_usage
  drop constraint if exists model_usage_provider_check;

alter table model_usage
  add constraint model_usage_provider_check
    check (provider in ('voyage', 'anthropic', 'assemblyai', 'runpod'));
