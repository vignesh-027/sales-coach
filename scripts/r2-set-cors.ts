/**
 * One-shot: install the CORS policy on the R2 bucket so the browser can PUT directly.
 *
 * Run once:
 *   npx tsx --env-file=.env.local scripts/r2-set-cors.ts
 *
 * Idempotent — re-running just overwrites the rule.
 *
 * Allows PUT from localhost and the deployed origin (set R2_CORS_ORIGINS as
 * a comma-separated list to override; default = http://localhost:3000).
 */
import {
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "../services/r2/client";

async function main() {
  const origins = (process.env.R2_CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const s3 = r2Client();
  console.log(`[r2-cors] bucket=${R2_BUCKET} origins=${origins.join(", ")}`);

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: R2_BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedOrigins: origins,
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );

  const verify = await s3.send(
    new GetBucketCorsCommand({ Bucket: R2_BUCKET }),
  );
  console.log("[r2-cors] installed:");
  console.log(JSON.stringify(verify.CORSRules, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
