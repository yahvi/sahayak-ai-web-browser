import { LIMITS } from "../shared/limits";
import type { PendingIntent, PendingIntentKind } from "../shared/protocol";
import { setPendingIntent } from "../shared/storage";

export const CONTEXT_MENU_IDS = {
  explain: "sahayak-explain",
  translate: "sahayak-translate",
  draft: "sahayak-draft-reply",
} as const;

/**
 * Registers the three selection context menus (architecture §10.3).
 * Safe against duplicate registration on reload.
 */
export function registerContextMenus(): void {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.explain,
        title: "Explain this with Sahayak",
        contexts: ["selection"],
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.translate,
        title: "Translate selection",
        contexts: ["selection"],
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.draft,
        title: "Draft a reply",
        contexts: ["selection"],
      });
    });
  } catch {
    // ignore in environments without contextMenus API
  }
}

/**
 * Handles context menu clicks on selection (architecture §10.3 & Slice 7).
 * Writes pendingIntent to session storage, then opens the side panel.
 */
export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  const rawSelection = info.selectionText?.trim() ?? "";
  if (!rawSelection) {
    return;
  }

  // Cap selection at 4,000 characters (architecture §10.3 & limits.ts)
  const selectionText =
    rawSelection.length > LIMITS.selectionChars
      ? rawSelection.slice(0, LIMITS.selectionChars)
      : rawSelection;

  let kind: PendingIntentKind;
  switch (info.menuItemId) {
    case CONTEXT_MENU_IDS.explain:
      kind = "explain";
      break;
    case CONTEXT_MENU_IDS.translate:
      kind = "translate";
      break;
    case CONTEXT_MENU_IDS.draft:
      kind = "draft";
      break;
    default:
      return;
  }

  const tabId = tab?.id ?? 0;
  const url = tab?.url ?? "";

  const intent: PendingIntent = {
    kind,
    selectionText,
    tabId,
    url,
    createdAt: Date.now(),
  };

  // 1. Write intent to session storage (Slice 7 step 2)
  await setPendingIntent(intent);

  // 2. Open side panel immediately using user gesture
  if (tabId && typeof chrome.sidePanel !== "undefined") {
    try {
      await chrome.sidePanel.open({ tabId });
    } catch {
      if (tab?.windowId) {
        try {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        } catch {
          // ignore
        }
      }
    }
  }

  // 3. In case the side panel is already open, broadcast the intent directly
  try {
    await chrome.runtime.sendMessage({
      v: 1,
      id: crypto.randomUUID(),
      cmd: "intent/pending",
      tabId,
      payload: intent,
    });
  } catch {
    // ignore if panel is closed; panel/ready will fetch from session storage
  }
}

export function startContextMenus(): void {
  registerContextMenus();

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleContextMenuClick(info, tab);
  });
}

