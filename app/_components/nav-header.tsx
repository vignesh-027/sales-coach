"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProfileMenu, type ProfileMenuUser } from "./profile-menu";

export interface NavSupabaseConfig {
  url: string;
  anonKey: string;
}

// One header used everywhere — list pages, detail pages, loading.tsx, etc.
// Active tab + Add button are derived from the URL (usePathname), so callers
// pass nothing about route state. user + supabase are optional so loading.tsx
// (which has no user fetch) can render the exact same chrome — only the
// profile-menu slot stays empty during the loading flash.
export function NavHeader({
  user,
  supabase,
}: {
  user?: ProfileMenuUser;
  supabase?: NavSupabaseConfig;
}) {
  const pathname = usePathname() ?? "";
  const isCalls = pathname === "/calls" || pathname.startsWith("/calls/");
  const isKnowledge =
    pathname === "/knowledge" || pathname.startsWith("/knowledge/");

  // The Upload button slot is always rendered so the profile-menu position
  // never shifts between pages. We only flip visibility per route/role:
  //   - /calls          → visible (everyone can upload calls)
  //   - /knowledge      → visible for admins; hidden placeholder for others
  //   - anywhere else   → hidden placeholder (admin pages, detail pages,
  //                       etc.) — keeps the profile menu aligned with /calls
  //                       and /knowledge.
  let addHref = "/calls/add"; // harmless default; hidden when not on /calls or /knowledge
  let addHidden = true;
  if (pathname === "/calls") {
    addHref = "/calls/add";
    addHidden = false;
  } else if (pathname === "/knowledge") {
    addHref = "/knowledge/add";
    addHidden = !(user && user.isAdmin);
  }

  return (
    <header className="top">
      <div className="top-inner">
        <div className="top-row1">
          <span className="brand-mark">
            <span className="ic" />
            Sales Coach
          </span>
          <nav className="top-nav">
            <ul>
              <li>
                <Link href="/calls" className={isCalls ? "active" : ""}>
                  Calls
                </Link>
              </li>
              <li>
                <Link
                  href="/knowledge"
                  className={isKnowledge ? "active" : ""}
                >
                  Knowledge
                </Link>
              </li>
            </ul>
          </nav>
          <div className="top-right">
            <Link
              href={addHref}
              className="btn"
              style={addHidden ? { visibility: "hidden" } : undefined}
              aria-hidden={addHidden || undefined}
              tabIndex={addHidden ? -1 : undefined}
            >
              <PlusIcon />
              Upload
            </Link>
            {user && supabase && (
              <ProfileMenu
                user={user}
                supabaseUrl={supabase.url}
                supabaseAnonKey={supabase.anonKey}
              />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 1.5v11M1.5 7h11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
