import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits";
import { calculateTargetDimensions, parseDataUrl } from "./image";

describe("calculateTargetDimensions", () => {
  it("keeps dimensions unchanged when already smaller than maxEdge", () => {
    const result = calculateTargetDimensions(800, 600, 1280);
    expect(result).toEqual({ width: 800, height: 600 });
  });

  it("scales down maintaining aspect ratio when width is longest edge", () => {
    // 2560 x 1440 scaled down to max edge 1280
    const result = calculateTargetDimensions(2560, 1440, 1280);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it("scales down maintaining aspect ratio when height is longest edge", () => {
    // 1080 x 1920 scaled down to max edge 1280
    const result = calculateTargetDimensions(1080, 1920, 1280);
    expect(result.height).toBe(1280);
    expect(result.width).toBe(720);
  });

  it("uses LIMITS.screenshotLongestEdge by default (1280)", () => {
    expect(LIMITS.screenshotLongestEdge).toBe(1280);
    const result = calculateTargetDimensions(3840, 2160);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });
});

describe("parseDataUrl", () => {
  it("parses valid data URLs correctly", () => {
    const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const parsed = parseDataUrl(dataUrl);
    expect(parsed).toEqual({
      mimeType: "image/jpeg",
      base64: "/9j/4AAQSkZJRg==",
    });
  });

  it("returns null on invalid data URLs", () => {
    expect(parseDataUrl("https://example.com/image.png")).toBeNull();
    expect(parseDataUrl("data:text/plain,notbase64")).toBeNull();
  });
});

