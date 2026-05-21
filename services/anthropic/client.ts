import Anthropic from "@anthropic-ai/sdk";
import { getAppSettings } from "@/services/supabase/queries/app-settings";
import { DEFAULT_LLM_MODEL, isAllowedLlmModel } from "./models";

let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.Claude_API_Key;
  if (!apiKey) throw new Error("Missing Claude_API_Key");
  cached = new Anthropic({ apiKey });
  return cached;
}

/**
 * Resolves the Claude model ID for runtime use. Reads from app_settings
 * (5-min in-process cache via getAppSettings) and falls back to the
 * compiled default if either the setting is missing/unreadable or the
 * stored value is no longer on the allow-list (e.g. an admin set a model
 * we later removed from LLM_OPTIONS).
 */
export async function getClaudeModel(): Promise<string> {
  try {
    const settings = await getAppSettings();
    if (isAllowedLlmModel(settings.llm_model)) return settings.llm_model;
    // eslint-disable-next-line no-console
    console.warn(
      `[anthropic] app_settings.llm_model="${settings.llm_model}" not in allow-list; falling back to ${DEFAULT_LLM_MODEL}`,
    );
    return DEFAULT_LLM_MODEL;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[anthropic] getAppSettings failed (${err instanceof Error ? err.message : String(err)}); falling back to ${DEFAULT_LLM_MODEL}`,
    );
    return DEFAULT_LLM_MODEL;
  }
}
