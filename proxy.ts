import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/services/supabase/proxy";

const PUBLIC_PREFIXES = [
  "/signin",
  "/auth/callback",
  "/api/calls/transcription-callback",
  "/api/knowledge/transcription-callback",
];

export async function proxy(req: NextRequest) {
  const { response, user } = await updateSession(req);
  const { pathname } = req.nextUrl;

  if (pathname === "/") return response;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return response;

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("next", pathname);
    url.hash = "signin";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
