import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/services/supabase/server";
import { upsertAuthUser } from "@/services/supabase/queries/users";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/calls";
  if (!code) {
    return NextResponse.redirect(new URL("/?error=missing_code#signin", url.origin));
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return NextResponse.redirect(new URL("/?error=exchange#signin", url.origin));
  }

  const user = data.user;
  const email = (user.email ?? "").toLowerCase();
  if (!email.endsWith("@soexcellence.com")) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/?error=domain#signin", url.origin));
  }

  await upsertAuthUser({
    authUserId: user.id,
    email,
    fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
  });

  return NextResponse.redirect(new URL(next, url.origin));
}
