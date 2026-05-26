"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export interface ProfileMenuUser {
  name: string;
  email: string | null;
  isAdmin: boolean;
}

export function ProfileMenu({
  user,
  supabaseUrl,
  supabaseAnonKey,
}: {
  user: ProfileMenuUser;
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "·";

  async function doSignOut() {
    setSigningOut(true);
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    await supabase.auth.signOut();
    router.push("/signin");
    router.refresh();
  }

  return (
    <div className="profile-menu" ref={ref}>
      <button
        type="button"
        className="avatar"
        onClick={() => setOpen((v) => !v)}
        aria-label="Profile menu"
      >
        {initials}
      </button>
      {open && (
        <div className="profile-dropdown" role="menu">
          <div className="dd-header">
            <div className="dd-name">{user.name}</div>
            {user.email && <div className="dd-email">{user.email}</div>}
          </div>
          <div className="dd-divider" />
          {/* Settings is admin-only today (both subsections require admin).
              For non-admins we render a visually-hidden placeholder so the
              dropdown's height and alignment stay identical regardless of role. */}
          {user.isAdmin ? (
            <Link
              className="dd-item"
              role="menuitem"
              href="/settings/configuration"
              onClick={() => setOpen(false)}
            >
              Settings
            </Link>
          ) : (
            <span
              className="dd-item"
              aria-hidden="true"
              style={{ visibility: "hidden" }}
            >
              Settings
            </span>
          )}
          {/* Observability is read-only and open to all signed-in users. */}
          <Link
            className="dd-item"
            role="menuitem"
            href="/observability"
            onClick={() => setOpen(false)}
          >
            Observability
          </Link>
          <button
            type="button"
            className="dd-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirmOut(true);
            }}
          >
            Logout
          </button>
        </div>
      )}

      {confirmOut && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmOut(false);
          }}
        >
          <div className="confirm-card">
            <h3>Sign out?</h3>
            <p className="sub">You&apos;ll need to sign in again with your Google account.</p>
            <div className="acts">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setConfirmOut(false)}
                disabled={signingOut}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-confirm-danger"
                onClick={doSignOut}
                disabled={signingOut}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
