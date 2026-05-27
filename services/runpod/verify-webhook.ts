// RunPod webhook verification.
//
// Unlike AssemblyAI (which lets you register a per-job header value),
// RunPod does not natively sign webhooks. The conventional fix is to put
// a shared secret in the webhook URL itself as a query string the
// dispatcher knows but a random attacker would not.
//
// We pass `?secret=<RunPod_Webhook_Secret>` on every webhook URL we
// register at submit time. The callback route extracts and constant-time
// compares it against process.env.RunPod_Webhook_Secret.

export function verifyRunPodWebhook(req: Request): boolean {
  const expected = process.env.RunPod_Webhook_Secret;
  if (!expected) return false;
  const url = new URL(req.url);
  const got = url.searchParams.get("secret");
  if (!got) return false;
  if (got.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < got.length; i++) {
    mismatch |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
