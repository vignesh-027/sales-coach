import type { TranscriptSegment } from "@/services/supabase/queries/transcripts";

export interface Chunk {
  text: string;
  start_ts_ms: number;
  end_ts_ms: number;
}

const TARGET_CHARS = 3200; // ~800 tokens
const OVERLAP_CHARS = 600; // ~150 tokens

export function chunkTranscript(segments: TranscriptSegment[]): Chunk[] {
  if (segments.length === 0) return [];

  const chunks: Chunk[] = [];
  let buf: TranscriptSegment[] = [];
  let bufChars = 0;

  const flush = () => {
    if (buf.length === 0) return;
    const text = buf
      .map((s) => `Speaker ${s.speaker}: ${s.text}`)
      .join("\n")
      .trim();
    chunks.push({
      text,
      start_ts_ms: buf[0].start_ms,
      end_ts_ms: buf[buf.length - 1].end_ms,
    });
  };

  for (const seg of segments) {
    const segLine = `Speaker ${seg.speaker}: ${seg.text}\n`;
    if (bufChars + segLine.length > TARGET_CHARS && buf.length > 0) {
      flush();
      // overlap: keep tail segments whose combined length is ~OVERLAP_CHARS
      const tail: TranscriptSegment[] = [];
      let tailChars = 0;
      for (let i = buf.length - 1; i >= 0; i--) {
        const lineLen = `Speaker ${buf[i].speaker}: ${buf[i].text}\n`.length;
        if (tailChars + lineLen > OVERLAP_CHARS) break;
        tail.unshift(buf[i]);
        tailChars += lineLen;
      }
      buf = tail;
      bufChars = tailChars;
    }
    buf.push(seg);
    bufChars += segLine.length;
  }
  flush();

  return chunks;
}

/**
 * Split a plain-text document into ~TARGET_CHARS chunks with OVERLAP_CHARS overlap,
 * preferring paragraph boundaries. Used for text-only knowledge sources.
 */
export function chunkText(fullText: string): Chunk[] {
  const text = fullText.trim();
  if (text.length === 0) return [];
  if (text.length <= TARGET_CHARS) {
    return [{ text, start_ts_ms: 0, end_ts_ms: 0 }];
  }
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + TARGET_CHARS, text.length);
    if (end < text.length) {
      const slice = text.slice(i, end);
      const lastBreak = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf(". "),
      );
      if (lastBreak > TARGET_CHARS * 0.5) end = i + lastBreak + 1;
    }
    chunks.push({
      text: text.slice(i, end).trim(),
      start_ts_ms: 0,
      end_ts_ms: 0,
    });
    if (end >= text.length) break;
    i = end - OVERLAP_CHARS;
    if (i < 0) i = 0;
  }
  return chunks;
}
