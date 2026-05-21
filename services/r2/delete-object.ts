import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "./client";

export async function deleteR2Object(key: string): Promise<void> {
  await r2Client().send(
    new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }),
  );
}
