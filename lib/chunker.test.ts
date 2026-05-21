import { describe, expect, it } from "vitest";
import { chunkTranscript } from "./chunker";

describe("chunkTranscript", () => {
  it("returns no chunks for empty input", () => {
    expect(chunkTranscript([])).toEqual([]);
  });

  it("packs short transcript into one chunk", () => {
    const chunks = chunkTranscript([
      { speaker: "A", start_ms: 0, end_ms: 1000, text: "Hello." },
      { speaker: "B", start_ms: 1000, end_ms: 2000, text: "Hi there." },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start_ts_ms).toBe(0);
    expect(chunks[0].end_ts_ms).toBe(2000);
    expect(chunks[0].text).toContain("Hello.");
    expect(chunks[0].text).toContain("Hi there.");
  });

  it("splits long transcript into multiple chunks with monotonic timestamps", () => {
    const filler = "the quick brown fox jumps over the lazy dog ".repeat(20);
    const segments = Array.from({ length: 50 }, (_, i) => ({
      speaker: i % 2 === 0 ? "A" : "B",
      start_ms: i * 5000,
      end_ms: (i + 1) * 5000,
      text: `${filler} (segment ${i})`,
    }));
    const chunks = chunkTranscript(segments);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start_ts_ms).toBeGreaterThanOrEqual(
        chunks[i - 1].start_ts_ms,
      );
      expect(chunks[i].end_ts_ms).toBeGreaterThanOrEqual(chunks[i].start_ts_ms);
    }
  });
});
