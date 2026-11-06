import type { ActionNode } from "../shared/protocol";
import { classifyField } from "../shared/safety-policy";

const elementRegistry = new Map<number, HTMLElement>();

export function getElementByN(n: number): HTMLElement | undefined {
  return elementRegistry.get(n);
}

export function clearRegistry(): void {
  elementRegistry.clear();
}

export function getElementRegistry(): Map<number, HTMLElement> {
  return elementRegistry;
}

function getAccessibleName(el: HTMLElement, doc: Document): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();

  const ariaLabelledBy = el.getAttribute("aria-labelledby");
  if (ariaLabelledBy?.trim()) {
    const labelledByEl = doc.getElementById(ariaLabelledBy.trim());
    const labelText = labelledByEl?.textContent?.trim();
    if (labelText) return labelText.slice(0, 80);
  }

  // Associated <label for="...">
  if (el.id) {
    const escapedId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(el.id)
        : el.id;
    const label = doc.querySelector<HTMLLabelElement>(`label[for="${escapedId}"]`);
    const labelText = label?.textContent?.trim();
    if (labelText) return labelText.slice(0, 80);
  }

  // Enclosing <label>
  if (el.closest) {
    const parentLabel = el.closest("label");
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      // remove input itself from label text if nested
      const nestedInput = clone.querySelector("input, select, textarea");
      nestedInput?.remove();
      const labelText = clone.textContent?.trim();
      if (labelText) return labelText.slice(0, 80);
    }
  }

  const title = el.getAttribute("title");
  if (title?.trim()) return title.trim();

  const placeholder = el.getAttribute("placeholder");
  if (placeholder?.trim()) return placeholder.trim();

  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const inputEl = el as HTMLInputElement;
    const type = (inputEl.type || el.getAttribute("type") || "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") {
      const val = inputEl.value?.trim() || el.getAttribute("value")?.trim();
      if (val) return val;
    }
    const name = el.getAttribute("name");
    if (name?.trim()) return name.trim();
  }

  const text = (el.innerText ?? el.textContent ?? "").trim();
  if (text) {
    return text.slice(0, 80);
  }

  const id = el.id;
  if (id) return `#${id}`;

  return tag;
}

function isVisible(el: HTMLElement, doc: Document): boolean {
  // Exclude overlay nodes with Sahayak prefix or attributes
  if (el.getAttribute("data-sahayak") === "true") {
    return false;
  }
  if (el.className && typeof el.className === "string" && el.className.includes("sahayak-")) {
    return false;
  }
  if (el.id && el.id.includes("sahayak-")) {
    return false;
  }
  if (el.closest && el.closest("[data-sahayak='true'], [class*='sahayak-'], [id*='sahayak-']")) {
    return false;
  }

  // Skip disabled controls
  if (
    el.hasAttribute("disabled") ||
    (el as HTMLButtonElement).disabled ||
    el.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }

  // Skip aria-hidden and hidden attribute
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") {
    return false;
  }

  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : null);
  const style = win?.getComputedStyle ? win.getComputedStyle(el) : null;
  if (style) {
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
  }

  // Skip zero-size controls
  if (typeof el.getBoundingClientRect === "function") {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
  }

  return true;
}

/**
 * Scans the document for interactive controls (architecture §11.1).
 * Assigns each element a stable number `n` for this generation in visual order.
 */
export function scanElements(doc: Document = document): ActionNode[] {
  elementRegistry.clear();

  const selector =
    'button, [role="button"], a[href], [role="link"], input:not([type="hidden"]), textarea, select';
  const rawNodes = Array.from(doc.querySelectorAll<HTMLElement>(selector));

  // Filter visible interactive controls
  const visibleNodes = rawNodes.filter((el) => isVisible(el, doc));

  // Sort in visual order (top-to-bottom, left-to-right) where geometry is available
  visibleNodes.sort((a, b) => {
    const rectA =
      typeof a.getBoundingClientRect === "function"
        ? a.getBoundingClientRect()
        : { top: 0, left: 0 };
    const rectB =
      typeof b.getBoundingClientRect === "function"
        ? b.getBoundingClientRect()
        : { top: 0, left: 0 };

    if (Math.abs(rectA.top - rectB.top) > 8) {
      return rectA.top - rectB.top;
    }
    return rectA.left - rectB.left;
  });

  const actionNodes: ActionNode[] = [];
  let n = 1;

  for (const el of visibleNodes) {
    const tag = el.tagName.toLowerCase();
    let role = el.getAttribute("role") || tag;
    let type: string | undefined = undefined;
    let isProtected = false;
    let valuePreview: string | undefined = undefined;

    if (tag === "input") {
      const inputEl = el as HTMLInputElement;
      type = (inputEl.type || el.getAttribute("type") || "text").toLowerCase();

      if (type === "checkbox" || type === "radio") {
        role = type;
      } else if (type === "submit" || type === "button" || type === "reset") {
        role = "button";
      } else {
        role = "input";
      }

      const fieldClass = classifyField({
        type,
        name: el.getAttribute("name") || inputEl.name,
        id: el.id,
        autocomplete: el.getAttribute("autocomplete") || inputEl.autocomplete,
      });

      if (fieldClass !== "normal") {
        isProtected = true;
      } else if (type === "checkbox" || type === "radio") {
        valuePreview = inputEl.checked ? "checked" : "unchecked";
      } else if (inputEl.value) {
        valuePreview = inputEl.value.slice(0, 30);
      }
    } else if (tag === "textarea") {
      const textEl = el as HTMLTextAreaElement;
      role = "textarea";

      const fieldClass = classifyField({
        name: el.getAttribute("name") || textEl.name,
        id: el.id,
        autocomplete: el.getAttribute("autocomplete") || textEl.autocomplete,
      });

      if (fieldClass !== "normal") {
        isProtected = true;
      } else if (textEl.value) {
        valuePreview = textEl.value.slice(0, 30);
      }
    } else if (tag === "select") {
      const selectEl = el as HTMLSelectElement;
      role = "select";
      if (selectEl.options && selectEl.selectedIndex >= 0) {
        valuePreview = selectEl.options[selectEl.selectedIndex]?.text?.trim() || undefined;
      }
    } else if (tag === "a") {
      role = "link";
    }

    const name = getAccessibleName(el, doc);

    elementRegistry.set(n, el);

    actionNodes.push({
      n,
      role,
      name,
      ...(type ? { type } : {}),
      ...(valuePreview ? { valuePreview } : {}),
      ...(isProtected ? { protected: true } : {}),
    });

    n++;
  }

  return actionNodes;
}
