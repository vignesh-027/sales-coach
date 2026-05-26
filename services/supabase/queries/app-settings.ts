// Singleton app_settings access.
//
// Reads are cached in-process for 5 minutes — a worker picking up the LLM
// model on every call would hammer Supabase needlessly. Writes invalidate
// the cache so an admin-driven change shows up on the very next read in the
// same process; other processes (workers) pick it up within the TTL.

import { supabaseAdmin } from "../client-admin";

export interface AppSettings {
  llm_model: string;
  rerank_model: string;
  transcription_model: string;
  updated_at: string;
  updated_by: string | null;
}

const SETTINGS_ID = "global";
const CACHE_TTL_MS = 5 * 60 * 1000;
const SELECT_COLS =
  "llm_model, rerank_model, transcription_model, updated_at, updated_by";

let cache: { value: AppSettings; expiresAt: number } | null = null;

export function clearAppSettingsCache(): void {
  cache = null;
}

export async function getAppSettings(): Promise<AppSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const s = supabaseAdmin();
  const { data, error } = await s
    .from("app_settings")
    .select(SELECT_COLS)
    .eq("id", SETTINGS_ID)
    .single();

  if (error) {
    throw new Error(`failed to load app_settings: ${error.message}`);
  }
  const value = data as AppSettings;
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function getRerankModel(): Promise<string> {
  const s = await getAppSettings();
  return s.rerank_model;
}

export async function updateLlmModel(
  model: string,
  userId: string | null,
): Promise<AppSettings> {
  const s = supabaseAdmin();
  const { data, error } = await s
    .from("app_settings")
    .update({ llm_model: model, updated_by: userId })
    .eq("id", SETTINGS_ID)
    .select(SELECT_COLS)
    .single();

  if (error) {
    throw new Error(`failed to update llm_model: ${error.message}`);
  }
  clearAppSettingsCache();
  return data as AppSettings;
}

export async function updateRerankModel(
  model: string,
  userId: string | null,
): Promise<AppSettings> {
  const s = supabaseAdmin();
  const { data, error } = await s
    .from("app_settings")
    .update({ rerank_model: model, updated_by: userId })
    .eq("id", SETTINGS_ID)
    .select(SELECT_COLS)
    .single();

  if (error) {
    throw new Error(`failed to update rerank_model: ${error.message}`);
  }
  clearAppSettingsCache();
  return data as AppSettings;
}

export async function updateTranscriptionModel(
  model: string,
  userId: string | null,
): Promise<AppSettings> {
  const s = supabaseAdmin();
  const { data, error } = await s
    .from("app_settings")
    .update({ transcription_model: model, updated_by: userId })
    .eq("id", SETTINGS_ID)
    .select(SELECT_COLS)
    .single();

  if (error) {
    throw new Error(`failed to update transcription_model: ${error.message}`);
  }
  clearAppSettingsCache();
  return data as AppSettings;
}
