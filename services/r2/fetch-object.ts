import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "./client";

export async function fetchR2Text(key: string): Promise<string> {
  const res = await r2Client().send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
  );
  const body = res.Body;
  if (!body) throw new Error(`empty body for ${key}`);
  return (await (body as unknown as { transformToString: (enc: string) => Promise<string> }).transformToString("utf-8"));
}

export async function fetchR2Bytes(key: string): Promise<Buffer> {
  const res = await r2Client().send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
  );
  const body = res.Body;
  if (!body) throw new Error(`empty body for ${key}`);
  const bytes = (await (body as unknown as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
  return Buffer.from(bytes);
}
