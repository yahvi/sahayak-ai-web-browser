import type { ActPayload, Result } from "../shared/protocol";
import { err, ok } from "../shared/protocol";
import { classifyField, isConsequentialName } from "../shared/safety-policy";
import { clearOverlays } from "./overlay";
import { getElementByN } from "./scan";

/**
 * Executes a single approved action on element n (architecture §8.4 & Slice 12).
 * Enforces:
 * - target field is not protected (type on password/OTP/card -> protected_field)
 * - consequential names require confirmedConsequential -> needs_extra_confirm
 * - done ends the run without DOM action
 */
export function executeAct(
  payload: ActPayload,
  doc?: Document,
): Result<{ executed: boolean; n?: number; type: string }> {
  const { type, n, value, confirmedConsequential } = payload;

  // 1. "done" ends the run without a DOM action
  if (type === "done") {
    const currentDoc = doc ?? (typeof document !== "undefined" ? document : undefined);
    if (currentDoc) {
      clearOverlays(currentDoc);
    }
    return ok({ executed: true, type: "done" });
  }

  if (typeof n !== "number") {
    return err("generic", "Element number required.");
  }

  const el = getElementByN(n);
  if (!el) {
    return err("generic", `Element [${n}] not found on page.`);
  }

  const inputEl = el as HTMLInputElement;
  const tag = el.tagName.toLowerCase();

  // 2. Policy: password/OTP/card field never receives a type action
  const fieldClass = classifyField({
    type: inputEl.type || el.getAttribute("type"),
    name: inputEl.name || el.getAttribute("name"),
    id: el.id,
    autocomplete: inputEl.autocomplete || el.getAttribute("autocomplete"),
  });

  if (fieldClass !== "normal") {
    if (type === "type") {
      return err("protected_field");
    }
  }

  // 3. Consequential names require second confirmation (needs_extra_confirm)
  const accessibleText = [
    el.innerText,
    el.textContent,
    inputEl.value,
    el.getAttribute("aria-label"),
    el.getAttribute("title"),
    el.getAttribute("name"),
  ]
    .filter(Boolean)
    .join(" ");

  if (isConsequentialName(accessibleText) && !confirmedConsequential) {
    return err("needs_extra_confirm");
  }

  // 4. Execute the verified DOM action
  try {
    switch (type) {
      case "click": {
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        if (typeof el.focus === "function") {
          el.focus();
        }
        el.click();
        return ok({ executed: true, n, type: "click" });
      }

      case "type": {
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        if (typeof el.focus === "function") {
          el.focus();
        }

        if (tag === "input" || tag === "textarea" || "value" in el) {
          inputEl.value = value ?? "";
          if (typeof el.dispatchEvent === "function") {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
          return ok({ executed: true, n, type: "type" });
        }

        return err("generic", "Target element is not a text input or textarea.");
      }

      case "select": {
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        if (typeof el.focus === "function") {
          el.focus();
        }

        const selectEl = el as HTMLSelectElement;
        if (tag === "select" || selectEl.options) {
          if (value && selectEl.options) {
            let found = false;
            for (let i = 0; i < selectEl.options.length; i++) {
              const opt = selectEl.options[i];
              if (
                opt.value.toLowerCase() === value.toLowerCase() ||
                opt.text.toLowerCase().includes(value.toLowerCase())
              ) {
                selectEl.selectedIndex = i;
                found = true;
                break;
              }
            }
            if (!found) {
              selectEl.value = value;
            }
            if (typeof el.dispatchEvent === "function") {
              selectEl.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
          return ok({ executed: true, n, type: "select" });
        }

        return err("generic", "Target element is not a select dropdown.");
      }

      case "scroll": {
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return ok({ executed: true, n, type: "scroll" });
      }

      default:
        return err("generic", `Unsupported action type: ${type}`);
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : "DOM action failed.";
    return err("generic", detail);
  }
}
