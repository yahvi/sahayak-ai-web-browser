import type { ActiveTabInfo } from "../shared/protocol";

let active: ActiveTabInfo | null = null;

export function getTrackedTab(): ActiveTabInfo | null {
  return active;
}

export async function refreshActiveTab(): Promise<ActiveTabInfo | null> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (!tab?.id) {
    active = null;
    return null;
  }

  active = {
    tabId: tab.id,
    url: tab.url ?? "",
    title: tab.title ?? "",
  };
  return active;
}

export function startTabTracking(): void {
  void refreshActiveTab();

  chrome.tabs.onActivated.addListener(() => {
    void refreshActiveTab();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!active || tabId !== active.tabId) return;
    if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
      active = {
        tabId,
        url: tab.url ?? active.url,
        title: tab.title ?? active.title,
      };
    }
  });

  chrome.windows.onFocusChanged.addListener(() => {
    void refreshActiveTab();
  });
}
