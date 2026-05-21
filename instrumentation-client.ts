import * as Sentry from "@sentry/nextjs";

// Browser-side init. The DSN must be available at build time as a
// NEXT_PUBLIC_* var because Next.js inlines those into the client bundle.
// `process.env.Sentry_DNS_URL` is NOT inlined for the browser, so the
// project must set `NEXT_PUBLIC_SENTRY_DSN` for client-side error capture
// to work. (Server-side falls back to either name.)
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

// Only capture browser errors in production builds. Local `next dev` runs
// (NODE_ENV=development) would otherwise flood the dashboard with noise.
const isProd = process.env.NODE_ENV === "production";

if (dsn && isProd) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    debug: false,
  });
}

// Tracks App Router client-side navigations so traces have route context.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
