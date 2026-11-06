/**
 * YouTube URL detection, videoId parsing, and timestamp utilities (architecture §10.2).
 */

export interface YouTubeVideoInfo {
  videoId: string;
  canonicalUrl: string;
}

/**
 * Parses a YouTube video URL and returns canonical watch URL and video ID.
 * Supports:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 */
export function parseYouTubeVideo(urlStr: string): YouTubeVideoInfo | null {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();

    // Check youtu.be/VIDEO_ID
    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      const id = url.pathname.replace(/^\/+/, "").split("/")[0]?.split("?")[0];
      if (id && /^[\w-]{6,}$/.test(id)) {
        return {
          videoId: id,
          canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
        };
      }
      return null;
    }

    const isYtHost =
      host === "www.youtube.com" ||
      host === "youtube.com" ||
      host === "m.youtube.com";

    if (!isYtHost) {
      return null;
    }

    // /watch?v=VIDEO_ID
    if (url.pathname === "/watch" || url.pathname.startsWith("/watch/")) {
      const v = url.searchParams.get("v");
      if (v && /^[\w-]{6,}$/.test(v)) {
        return {
          videoId: v,
          canonicalUrl: `https://www.youtube.com/watch?v=${v}`,
        };
      }
      return null;
    }

    // /shorts/VIDEO_ID
    if (url.pathname.startsWith("/shorts/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const id = parts[1];
      if (id && /^[\w-]{6,}$/.test(id)) {
        return {
          videoId: id,
          canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
        };
      }
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the URL is a supported YouTube watch or shorts URL.
 */
export function isYouTubeWatch(urlStr: string): boolean {
  return parseYouTubeVideo(urlStr) !== null;
}

/**
 * Converts a mm:ss or h:mm:ss timestamp into total seconds.
 * Example:
 * - "1:02" -> 62
 * - "01:02:03" -> 3723
 */
export function timestampToSeconds(timestamp: string): number {
  if (!timestamp || typeof timestamp !== "string") {
    return 0;
  }
  const clean = timestamp.trim().replace(/[\[\]()]/g, "");
  const parts = clean.split(":").map((p) => parseInt(p, 10));

  if (parts.some((p) => isNaN(p))) {
    return 0;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }

  return 0;
}

/**
 * Builds a canonical watch URL with seconds timestamp for seeking.
 */
export function buildYouTubeSeekUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(seconds)}s`;
}

