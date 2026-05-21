import { cookies } from "next/headers";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function supabaseServer(): Promise<SupabaseClient> {
  const url = process.env.Supabase_Project_URL;
  const anonKey = process.env.Supabase_Anon_Key;
  if (!url || !anonKey) {
    throw new Error("Missing Supabase_Project_URL or Supabase_Anon_Key");
  }
  const cookieStore = await cookies();
  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(toSet) {
      for (const { name, value, options } of toSet) {
        try {
          cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component — proxy.ts handles refresh.
        }
      }
    },
  };
  return createServerClient(url, anonKey, { cookies: cookieMethods });
}
