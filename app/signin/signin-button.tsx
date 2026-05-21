"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export function SignInButton({
  supabaseUrl,
  supabaseAnonKey,
  next,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  next: string;
}) {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { hd: "soexcellence.com", prompt: "select_account" },
      },
    });
    if (error) {
      setBusy(false);
      alert(error.message);
    }
  }

  return (
    <button
      type="button"
      className="submit-btn"
      onClick={signIn}
      disabled={busy}
      style={{ marginTop: 24, width: "100%" }}
    >
      {busy ? "Redirecting…" : "Continue with Google"}
    </button>
  );
}
