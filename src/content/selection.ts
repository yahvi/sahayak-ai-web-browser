import { LIMITS } from "../shared/limits";

/**
 * Extracts and sanitizes the user's current text selection from the page (architecture §10.3).
 * Trims whitespace and caps at 4,000 characters.
 */
export function getPageSelection(doc: Document = document): string {
  try {
    const win = doc.defaultView ?? (typeof window !== "undefined" ? window : null);
    const selection = win?.getSelection()?.toString() ?? "";
    const trimmed = selection.trim();

    if (!trimmed) {
      return "";
    }

    if (trimmed.length > LIMITS.selectionChars) {
      return trimmed.slice(0, LIMITS.selectionChars);
    }

    return trimmed;
  } catch {
    return "";
  }
}

