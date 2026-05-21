import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function supabaseServer(): SupabaseClient {
  const url = process.env.Supabase_Project_URL;
  const anonKey = process.env.Supabase_Anon_Key;
  if (!url || !anonKey) {
    throw new Error("Missing Supabase_Project_URL or Supabase_Anon_Key");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
