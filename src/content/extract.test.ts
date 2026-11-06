import { describe, expect, it } from "vitest";
import {
  isYouTubeWatchUrl,
  truncateExtract,
  TRUNCATION_MARKER,
} from "./extract";

describe("truncateExtract", () => {
  it("keeps text untouched if under the cap", () => {
    const text = "Short article with only a few words.";
    expect(truncateExtract(text, 12_000)).toBe(text);
  });

  it("truncates keeping both the start and the end for a long fixture", () => {
    const START_FIXTURE = "ARTICLE_START_LEDE: This is the very first paragraph of the breaking news story.";
    const END_FIXTURE = "ARTICLE_END_CONCLUSION: In summary, this concludes the final statement of the piece.";
    const PADDING = "Middle filler text repeated for length. ".repeat(600); // ~24,000 characters

    const fullText = `${START_FIXTURE}\n\n${PADDING}\n\n${END_FIXTURE}`;
    expect(fullText.length).toBeGreaterThan(12_000);

    const truncated = truncateExtract(fullText, 12_000);

    // Caps at or below 12,000 chars
    expect(truncated.length).toBeLessThanOrEqual(12_000);

    // Keeps start
    expect(truncated.startsWith(START_FIXTURE)).toBe(true);

    // Keeps end
    expect(truncated.endsWith(END_FIXTURE)).toBe(true);

    // Contains the omission marker in the middle
    expect(truncated).toContain(TRUNCATION_MARKER);
  });

  it("respects custom maxChars cap", () => {
    const text = "1234567890".repeat(20); // 200 chars
    const truncated = truncateExtract(text, 50);

    expect(truncated.length).toBeLessThanOrEqual(50);
    expect(truncated.startsWith("12345")).toBe(true);
    expect(truncated.endsWith("67890")).toBe(true);
  });
});

describe("isYouTubeWatchUrl", () => {
  it("detects standard YouTube watch URLs", () => {
    expect(
      isYouTubeWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe(true);
    expect(
      isYouTubeWatchUrl("https://youtube.com/watch?v=abc12345678&t=42s"),
    ).toBe(true);
  });

  it("detects youtu.be short URLs", () => {
    expect(isYouTubeWatchUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  it("detects YouTube shorts URLs", () => {
    expect(isYouTubeWatchUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      true,
    );
  });

  it("rejects non-video YouTube pages", () => {
    expect(isYouTubeWatchUrl("https://www.youtube.com/")).toBe(false);
    expect(isYouTubeWatchUrl("https://www.youtube.com/feed/subscriptions")).toBe(
      false,
    );
    expect(isYouTubeWatchUrl("https://studio.youtube.com/")).toBe(false);
  });

  it("rejects normal news articles and arbitrary URLs", () => {
    expect(
      isYouTubeWatchUrl("https://www.thehindu.com/news/national/article123.ece"),
    ).toBe(false);
    expect(isYouTubeWatchUrl("https://example.com/watch?v=123")).toBe(false);
    expect(isYouTubeWatchUrl("not-a-valid-url")).toBe(false);
  });
});

