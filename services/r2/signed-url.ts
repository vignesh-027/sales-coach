import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client, R2_BUCKET } from "./client";

export async function signedPutUrl(
  key: string,
  contentType: string,
  expiresInSec = 60 * 15,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2Client(), cmd, { expiresIn: expiresInSec });
}

export async function signedGetUrl(
  key: string,
  expiresInSec = 60 * 60,
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2Client(), cmd, { expiresIn: expiresInSec });
}
