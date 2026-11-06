import { describe, expect, it } from "vitest";
import {
  buildYouTubeSeekUrl,
  isYouTubeWatch,
  parseYouTubeVideo,
  timestampToSeconds,
} from "./youtube";

describe("YouTube URL detection and parsing", () => {
  it("detects and parses standard watch URLs", () => {
    const res = parseYouTubeVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(res).not.toBeNull();
    expect(res?.videoId).toBe("dQw4w9WgXcQ");
    expect(res?.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("normalises youtu.be short URLs to canonical watch URLs", () => {
    const res = parseYouTubeVideo("https://youtu.be/9hE5-98ZeCg?t=42s");
    expect(res).not.toBeNull();
    expect(res?.videoId).toBe("9hE5-98ZeCg");
    expect(res?.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=9hE5-98ZeCg",
    );
  });

  it("detects YouTube shorts URLs", () => {
    const res = parseYouTubeVideo("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    expect(res).not.toBeNull();
    expect(res?.videoId).toBe("dQw4w9WgXcQ");
    expect(res?.canonicalUrl).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("rejects non-video YouTube pages", () => {
    expect(parseYouTubeVideo("https://www.youtube.com/")).toBeNull();
    expect(
      parseYouTubeVideo("https://www.youtube.com/feed/subscriptions"),
    ).toBeNull();
    expect(parseYouTubeVideo("https://studio.youtube.com/")).toBeNull();
  });

  it("rejects news articles and general URLs", () => {
    expect(
      parseYouTubeVideo("https://www.bbc.com/news/technology-12345"),
    ).toBeNull();
    expect(parseYouTubeVideo("https://example.com/watch?v=123")).toBeNull();
    expect(isYouTubeWatch("https://nytimes.com")).toBe(false);
  });
});

describe("Timestamp conversion", () => {
  it("converts mm:ss to seconds", () => {
    expect(timestampToSeconds("1:02")).toBe(62);
    expect(timestampToSeconds("0:45")).toBe(45);
    expect(timestampToSeconds("12:30")).toBe(750);
  });

  it("converts h:mm:ss to seconds", () => {
    expect(timestampToSeconds("1:02:03")).toBe(3723);
    expect(timestampToSeconds("2:00:00")).toBe(7200);
  });

  it("handles bracketed or formatted timestamps", () => {
    expect(timestampToSeconds("[01:02]")).toBe(62);
    expect(timestampToSeconds("(02:15)")).toBe(135);
  });

  it("returns 0 on empty or invalid timestamps", () => {
    expect(timestampToSeconds("")).toBe(0);
    expect(timestampToSeconds("invalid")).toBe(0);
  });
});

describe("buildYouTubeSeekUrl", () => {
  it("generates correct seek URL with seconds", () => {
    expect(buildYouTubeSeekUrl("dQw4w9WgXcQ", 62)).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=62s",
    );
  });
});

