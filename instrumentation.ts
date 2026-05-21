import * as Sentry from "@sentry/nextjs";

// DSN is exposed as a NEXT_PUBLIC_* var so both server and browser code
// (instrumentation-client.ts) can read the same value.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

// Only capture errors in production. Localhost dev (NODE_ENV=development)
// would otherwise flood the dashboard with noise from in-progress work.
const isProd = process.env.NODE_ENV === "production";

export async function register() {
  if (!dsn || !isProd) {
    // Skip silently outside production or when no DSN is configured.
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      // Surface every captured error in logs while we get our bearings in prod.
      debug: false,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      debug: false,
    });
  }
}

// Required by Next.js 15+/16 to forward server-side errors (route handlers,
// server components, server actions) to Sentry.
export const onRequestError = Sentry.captureRequestError;
