import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  org: process.env.Sentry_Organization_Slug,
  project: process.env.Sentry_Project_Slug,
  authToken: process.env.Sentry_API_Token,

  // Only print Sentry CLI output in CI.
  silent: !process.env.CI,

  // Delete source maps from the build output after uploading them to Sentry
  // so they aren't served to browsers.
  sourcemaps: {
    filesToDeleteAfterUpload: [".next/**/*.map"],
  },

  // Avoid bundling Sentry's logger to keep client bundle smaller.
  disableLogger: true,

  // Annotate React components in stack traces (non-deprecated nested path).
  webpack: {
    reactComponentAnnotation: { enabled: true },
  },
});
