import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!cached) {
    const url = process.env.Supabase_Project_URL;
    const serviceKey = process.env.Supabase_Service_Role_Key;
    if (!url || !serviceKey) {
      throw new Error(
        "Missing Supabase_Project_URL or Supabase_Service_Role_Key",
      );
    }
    cached = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
