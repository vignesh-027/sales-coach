import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function updateSession(req: NextRequest): Promise<{
  response: NextResponse;
  user: { id: string; email: string | null } | null;
}> {
  const url = process.env.Supabase_Project_URL;
  const anonKey = process.env.Supabase_Anon_Key;
  if (!url || !anonKey) {
    throw new Error("Missing Supabase_Project_URL or Supabase_Anon_Key");
  }
  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) req.cookies.set(name, value);
        response = NextResponse.next({ request: req });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const u = data.user;
  return {
    response,
    user: u ? { id: u.id, email: u.email ?? null } : null,
  };
}
