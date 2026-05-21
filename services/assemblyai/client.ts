export const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";

export async function aaiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const apiKey = process.env.AssemblyAI_API_Key;
  if (!apiKey) throw new Error("Missing AssemblyAI_API_Key");
  const headers = new Headers(init.headers);
  headers.set("authorization", apiKey);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${ASSEMBLYAI_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AssemblyAI ${path} ${res.status}: ${text}`);
  }
  return res;
}
