import { getElementByN, getElementRegistry } from "./scan";

const OVERLAY_CONTAINER_ID = "sahayak-overlay-container";
let activeHighlightedElement: HTMLElement | null = null;
let originalOutline = "";
let originalOutlineOffset = "";

export function clearOverlays(doc?: Document): void {
  const currentDoc = doc ?? (typeof document !== "undefined" ? document : null);
  if (!currentDoc) {
    if (activeHighlightedElement) {
      activeHighlightedElement = null;
    }
    return;
  }
  const container = currentDoc.getElementById(OVERLAY_CONTAINER_ID);
  if (container) {
    container.remove();
  }
  if (activeHighlightedElement) {
    activeHighlightedElement.style.outline = originalOutline;
    activeHighlightedElement.style.outlineOffset = originalOutlineOffset;
    activeHighlightedElement = null;
  }
}

/**
 * Places numbered badges over scanned elements (architecture §11.1).
 */
export function renderOverlays(doc?: Document): void {
  const currentDoc = doc ?? (typeof document !== "undefined" ? document : null);
  if (!currentDoc || !currentDoc.body) return;

  clearOverlays(currentDoc);

  const container = currentDoc.createElement("div");
  container.id = OVERLAY_CONTAINER_ID;
  container.setAttribute("data-sahayak", "true");
  container.className = "sahayak-overlay-container";
  container.style.position = "absolute";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "100%";
  container.style.height = "100%";
  container.style.pointerEvents = "none";
  container.style.zIndex = "2147483640";

  const registry = getElementRegistry();
  const win = currentDoc.defaultView ?? (typeof window !== "undefined" ? window : null);
  const scrollY = win?.scrollY ?? 0;
  const scrollX = win?.scrollX ?? 0;

  for (const [n, el] of registry.entries()) {
    if (typeof el.getBoundingClientRect !== "function") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const badge = currentDoc.createElement("div");
      badge.setAttribute("data-sahayak", "true");
      badge.className = "sahayak-element-badge";
      badge.textContent = String(n);

      badge.style.position = "absolute";
      badge.style.top = `${rect.top + scrollY}px`;
      badge.style.left = `${rect.left + scrollX}px`;
      badge.style.background = "#0f766e";
      badge.style.color = "#ffffff";
      badge.style.fontSize = "11px";
      badge.style.fontWeight = "bold";
      badge.style.padding = "2px 6px";
      badge.style.borderRadius = "4px";
      badge.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";
      badge.style.pointerEvents = "none";
      badge.style.transform = "translate(-50%, -50%)";
      badge.style.zIndex = "2147483641";
      badge.style.fontFamily = "system-ui, -apple-system, sans-serif";
      badge.style.lineHeight = "1";

      container.appendChild(badge);
    }
  }

  currentDoc.body.appendChild(container);
}

/**
 * Scrolls element `n` into view and outlines it with accent color (architecture §11.2).
 * Does NOT click.
 */
export function highlightElement(n: number): boolean {
  if (activeHighlightedElement) {
    activeHighlightedElement.style.outline = originalOutline;
    activeHighlightedElement.style.outlineOffset = originalOutlineOffset;
    activeHighlightedElement = null;
  }

  const el = getElementByN(n);
  if (!el) {
    return false;
  }

  if (typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  originalOutline = el.style.outline ?? "";
  originalOutlineOffset = el.style.outlineOffset ?? "";
  el.style.outline = "3px solid #0f766e";
  el.style.outlineOffset = "2px";
  activeHighlightedElement = el;

  return true;
}

/**
 * Executes an approved action on element `n` (architecture §8.4).
 */
export function executeAction(
  n: number,
  type: "click" | "type" | "select" | "scroll" | "done",
  value?: string,
): { ok: boolean; message?: string } {
  const el = getElementByN(n);
  if (!el && type !== "done") {
    return { ok: false, message: `Element [${n}] not found on page.` };
  }

  switch (type) {
    case "click":
      el?.click();
      return { ok: true };
    case "type":
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
        el.value = value ?? "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      return { ok: false, message: "Element is not an input or textarea." };
    case "select":
      if (el instanceof HTMLSelectElement) {
        if (value) {
          el.value = value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return { ok: true };
      }
      return { ok: false, message: "Element is not a select dropdown." };
    case "scroll":
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return { ok: true };
    case "done":
      return { ok: true };
    default:
      return { ok: false, message: `Unsupported action type: ${type}` };
  }
}
