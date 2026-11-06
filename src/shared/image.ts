import { LIMITS } from "./limits";

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Calculates resized dimensions such that the longest edge does not exceed maxEdge,
 * preserving original aspect ratio (architecture §10.4 & limits.ts).
 */
export function calculateTargetDimensions(
  width: number,
  height: number,
  maxEdge: number = LIMITS.screenshotLongestEdge,
): ImageDimensions {
  if (width <= 0 || height <= 0) {
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }

  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = maxEdge / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Extracts the MIME type and raw base64 data string from a data URL.
 */
export function parseDataUrl(dataUrl: string): {
  mimeType: string;
  base64: string;
} | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  return {
    mimeType: match[1],
    base64: match[2],
  };
}

