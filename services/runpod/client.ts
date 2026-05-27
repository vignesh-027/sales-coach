// Thin wrapper around RunPod's Serverless API. Mirrors aaiFetch().
//
// Env:
//   RunPod_API      — account-wide bearer token from the RunPod console
//   RunPod_Endpoint_ID  — the WhisperX serverless endpoint id (per environment)
//
// Base URL is https://api.runpod.ai/v2/{endpoint_id}. Paths passed here are
// suffixes like "/run" or "/status/<job_id>".

export function runpodEndpointId(): string {
  const id = process.env.RunPod_Endpoint_ID;
  if (!id) throw new Error("Missing RunPod_Endpoint_ID");
  return id;
}

export function runpodBase(): string {
  return `https://api.runpod.ai/v2/${runpodEndpointId()}`;
}

export async function runpodFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const apiKey = process.env.RunPod_API;
  if (!apiKey) throw new Error("Missing RunPod_API");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${runpodBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RunPod ${path} ${res.status}: ${text}`);
  }
  return res;
}
