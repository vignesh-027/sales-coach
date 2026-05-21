// Turn anything thrown — Error, Anthropic APIError, fetch-style object, plain
// object — into a human-readable single-line string. We were getting
// "[object Object]" in process_error because some SDK errors stringify badly.

interface MaybeApiError {
  message?: unknown;
  name?: unknown;
  status?: unknown;
  error?: unknown;
  body?: unknown;
  cause?: unknown;
}

function pickMessage(o: MaybeApiError): string | null {
  if (typeof o.message === "string" && o.message && o.message !== "[object Object]") {
    return o.message;
  }
  return null;
}

function unwrapBody(body: unknown): string | null {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (typeof body === "object") {
    const b = body as MaybeApiError;
    const inner = b.error;
    if (inner && typeof inner === "object") {
      const m = (inner as MaybeApiError).message;
      if (typeof m === "string") return m;
    }
    if (typeof inner === "string") return inner;
    const m = pickMessage(b);
    if (m) return m;
    try {
      return JSON.stringify(body);
    } catch {
      return null;
    }
  }
  return String(body);
}

export function formatError(err: unknown): string {
  if (err == null) return "unknown error";
  if (typeof err === "string") return err;

  if (err instanceof Error) {
    const o = err as unknown as MaybeApiError;
    const parts: string[] = [];
    const msg = pickMessage(o) ?? err.name ?? "Error";
    parts.push(String(msg));
    if (typeof o.status === "number") parts.push(`status=${o.status}`);
    const inner = unwrapBody(o.error) ?? unwrapBody(o.body);
    if (inner && inner !== msg) parts.push(inner);
    if (o.cause && o.cause !== err) {
      const c = formatError(o.cause);
      if (c && !parts.join(" ").includes(c)) parts.push(`cause: ${c}`);
    }
    return parts.join(" · ");
  }

  if (typeof err === "object") {
    const o = err as MaybeApiError;
    const msg = pickMessage(o) ?? unwrapBody(o.error) ?? unwrapBody(o.body);
    if (msg) return msg;
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }

  return String(err);
}
