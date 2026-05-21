import { WEBHOOK_HEADER_NAME } from "./transcribe";

export function verifyWebhookSecret(
  req: Request,
  expectedSecret: string,
): boolean {
  const got = req.headers.get(WEBHOOK_HEADER_NAME);
  if (!got || !expectedSecret) return false;
  if (got.length !== expectedSecret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < got.length; i++) {
    mismatch |= got.charCodeAt(i) ^ expectedSecret.charCodeAt(i);
  }
  return mismatch === 0;
}
