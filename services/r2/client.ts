import { S3Client } from "@aws-sdk/client-s3";

let cached: S3Client | null = null;

// Resolved at module load with a safe empty fallback so the module can be
// imported during Next.js build-time page-data collection without env vars.
// At runtime, missing env produces a clear AWS "empty bucket" error.
export const R2_BUCKET: string = process.env.R2_BucketName ?? "";

export function r2Client(): S3Client {
  if (!cached) {
    const accountId = process.env.R2_AccountID;
    const accessKeyId = process.env.R2_Access_Key_ID;
    const secretAccessKey = process.env.R2_Secret_Access_Key;
    const endpoint =
      process.env.R2_S3API ??
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

    if (!accessKeyId || !secretAccessKey || !endpoint) {
      throw new Error(
        "Missing R2 credentials (R2_Access_Key_ID, R2_Secret_Access_Key, R2_S3API or R2_AccountID)",
      );
    }
    cached = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return cached;
}
