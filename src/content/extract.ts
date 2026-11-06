import { Readability } from "@mozilla/readability";
import { LIMITS } from "../shared/limits";
import type { PageExtract } from "../shared/protocol";
import { parseYouTubeVideo } from "../shared/youtube";

export const TRUNCATION_MARKER = "\n\n[...content truncated...]\n\n";

/**
 * Cap extracted text at maxChars (default 12,000), keeping both the start and end.
 */
export function truncateExtract(
  text: string,
  maxChars: number = LIMITS.extractChars,
): string {
  if (text.length <= maxChars) {
    return text;
  }

  if (maxChars <= TRUNCATION_MARKER.length) {
    return text.slice(0, maxChars);
  }

  const available = maxChars - TRUNCATION_MARKER.length;
  const half = Math.floor(available / 2);
  const start = text.slice(0, half);
  const end = text.slice(-half);

  return `${start}${TRUNCATION_MARKER}${end}`;
}

/**
 * Checks if a URL represents a supported YouTube video watch URL.
 */
export function isYouTubeWatchUrl(urlStr: string): boolean {
  return parseYouTubeVideo(urlStr) !== null;
}

/**
 * Checks if a URL belongs to youtube.com or youtu.be domain.
 */
export function isYouTubeDomain(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return (
      host === "www.youtube.com" ||
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be" ||
      host.endsWith(".youtu.be") ||
      host === "studio.youtube.com"
    );
  } catch {
    return false;
  }
}

/**
 * Extracts readable content from the document (architecture §10.1 & §10.2).
 * 1. Checks if the URL is a YouTube watch URL or non-watch YouTube page.
 * 2. Runs Readability on a cloned document for normal articles.
 * 3. Falls back to innerText if Readability yields nothing useful.
 * 4. Truncates keeping start and end up to LIMITS.extractChars (12,000 chars).
 */
export function extractPage(doc: Document = document): PageExtract {
  const url = doc.location?.href ?? "";
  const title = doc.title || "(untitled page)";

  // 1. YouTube watch / non-video pages
  const ytVideo = parseYouTubeVideo(url);
  if (ytVideo) {
    return {
      kind: "youtube",
      title,
      url,
      text: "",
      videoId: ytVideo.videoId,
      canonicalUrl: ytVideo.canonicalUrl,
    };
  }

  // Non-video YouTube pages (playlists, homepage, subscriptions, studio)
  // Per implementation plan step 7: show empty state, do not extract sidebar/comments as an article
  if (isYouTubeDomain(url)) {
    return {
      kind: "youtube",
      title,
      url,
      text: "",
    };
  }

  // 2. Readability on cloned document
  try {
    const clone = doc.cloneNode(true) as Document;
    const reader = new Readability(clone);
    const article = reader.parse();

    if (article?.textContent && article.textContent.trim().length > 100) {
      return {
        kind: "article",
        title: article.title || title,
        url,
        text: truncateExtract(article.textContent.trim(), LIMITS.extractChars),
        byline: article.byline || undefined,
        siteName: article.siteName || undefined,
      };
    }
  } catch {
    // Fall back to innerText below
  }

  // 3. Fallback to innerText as generic page
  const fallbackText = doc.body?.innerText?.trim() ?? "";
  return {
    kind: "generic",
    title,
    url,
    text: truncateExtract(fallbackText, LIMITS.extractChars),
  };
}
