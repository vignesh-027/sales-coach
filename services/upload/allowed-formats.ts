// Single source of truth for which media formats we accept for transcription.
// Conservative allow-list: only formats AssemblyAI handles reliably AND that
// are common for sales-call recordings. 3GPP/3GP are excluded — they often
// lack a usable audio track on iPhone exports and AAI rejects them at
// transcoding time with "File does not appear to contain audio".

export const AUDIO_EXTS = [
  "mp3",
  "m4a",
  "wav",
  "aac",
  "flac",
  "ogg",
  "opus",
] as const;

export const VIDEO_EXTS = ["mp4", "mov", "webm", "m4v"] as const;

export const TEXT_EXTS = ["txt", "md", "docx"] as const;

// Explicit deny-list. The user reported a 3GPP file passing through and
// getting stuck — be loud about why we reject it.
const DENIED_EXTS = new Set([
  "3gp",
  "3gpp",
  "3g2",
  "amr", // often single-channel narrowband; transcoding flake
  "wma",
]);

const DENIED_MIME_FRAGMENTS = ["3gpp", "3gp", "x-ms-wma"];

export type MediaFormat = "audio" | "video" | "text";

export function extFromFilename(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

export function classifyExt(ext: string): MediaFormat | null {
  if ((VIDEO_EXTS as readonly string[]).includes(ext)) return "video";
  if ((AUDIO_EXTS as readonly string[]).includes(ext)) return "audio";
  if ((TEXT_EXTS as readonly string[]).includes(ext)) return "text";
  return null;
}

export interface UploadValidation {
  ok: boolean;
  reason?: string;
  format?: MediaFormat;
}

export function validateUpload(
  filename: string,
  contentType: string | undefined,
): UploadValidation {
  const ext = extFromFilename(filename);
  if (!ext) return { ok: false, reason: "file has no extension" };

  if (DENIED_EXTS.has(ext)) {
    return {
      ok: false,
      reason: `.${ext} files are not supported (often lack a usable audio track). Re-export as .m4a, .mp3, or .mp4 and upload again.`,
    };
  }

  const ct = (contentType ?? "").toLowerCase();
  for (const frag of DENIED_MIME_FRAGMENTS) {
    if (ct.includes(frag)) {
      return {
        ok: false,
        reason: `MIME type "${contentType}" is not supported. Re-export as .m4a, .mp3, or .mp4 and upload again.`,
      };
    }
  }

  const format = classifyExt(ext);
  if (!format) {
    return {
      ok: false,
      reason: `.${ext} files are not supported. Use ${[...AUDIO_EXTS, ...VIDEO_EXTS]
        .map((e) => `.${e}`)
        .join(", ")} for media, or .txt/.md/.docx for text.`,
    };
  }
  return { ok: true, format };
}

// HTML <input accept="..."> string for media uploads (no text).
export const MEDIA_ACCEPT_ATTR = [
  ...AUDIO_EXTS.map((e) => `.${e}`),
  ...VIDEO_EXTS.map((e) => `.${e}`),
  "audio/*",
  "video/*",
].join(",");

export const VIDEO_ACCEPT_ATTR = [
  ...VIDEO_EXTS.map((e) => `.${e}`),
  "video/*",
].join(",");

export const TEXT_ACCEPT_ATTR = [
  ...TEXT_EXTS.map((e) => `.${e}`),
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");
