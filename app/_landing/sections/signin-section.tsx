"use client";

import { GoogleSignInPill } from "./google-signin-pill";

export function SignInSection({
  supabase,
  next,
  error,
}: {
  supabase: { url: string; anonKey: string };
  next: string;
  error?: string;
}) {
  return (
    <section className="lp-signin" id="signin">
      <div className="lp-wash" />
      <div className="lp-signin-wrap">
        <span className="lp-label">An invitation</span>
        <h2>
          Read your closings
          <br />
          <em>the way they read you.</em>
        </h2>
        <p className="lp-lede">
          Sign in to upload a closing call, open last week&apos;s critique, or browse
          the patterns the system has been keeping for you.
        </p>

        {error === "domain" && (
          <div className="lp-signin-err">
            That Google account isn&apos;t on soexcellence.com. Try a work account.
          </div>
        )}
        {error === "exchange" && (
          <div className="lp-signin-err">
            Sign-in couldn&apos;t finish. Try again.
          </div>
        )}
        {error === "missing_code" && (
          <div className="lp-signin-err">
            Sign-in link was incomplete. Try again.
          </div>
        )}

        <GoogleSignInPill
          supabaseUrl={supabase.url}
          supabaseAnonKey={supabase.anonKey}
          next={next}
        />
        <div className="lp-signin-fineprint">
          Only @soexcellence.com accounts can sign in.
        </div>
      </div>

      <div className="lp-signin-foot">
        <span className="lp-meta">sales Coach · Antano & Harini © School of Excellence</span>
      </div>
    </section>
  );
}
