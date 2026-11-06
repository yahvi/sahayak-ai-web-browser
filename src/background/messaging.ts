import { LIMITS } from "../shared/limits";
import {
  err,
  ok,
  type ActPayload,
  type Envelope,
  type PanelReadyData,
  type Result,
} from "../shared/protocol";
import { classifyUrl } from "../shared/safety-policy";
import {
  clearPendingIntent,
  getAgentRun,
  getPendingIntent,
  getSettings,
  setAgentRun,
} from "../shared/storage";
import { getTrackedTab, refreshActiveTab } from "./tab-tracker";

async function handlePanelReady(): Promise<Result<PanelReadyData>> {
  const intent = await getPendingIntent();
  if (!intent) {
    return ok({ pendingIntent: null });
  }

  const age = Date.now() - intent.createdAt;
  if (age > LIMITS.pendingIntentTtlMs) {
    await clearPendingIntent();
    return ok({ pendingIntent: null });
  }

  return ok({ pendingIntent: intent });
}

async function handleGetActiveTab(): Promise<
  Result<{ tabId: number; url: string; title: string }>
> {
  const tab = (await refreshActiveTab()) ?? getTrackedTab();
  if (!tab) {
    return err("generic", "No active tab is available.");
  }
  return ok(tab);
}

async function handleCaptureVisible(
  targetTabId?: number,
): Promise<Result<{ dataUrl: string }>> {
  const activeTab = (await refreshActiveTab()) ?? getTrackedTab();
  const tabId = targetTabId ?? activeTab?.tabId;

  if (!tabId) {
    return err("generic", "No active tab available for capture.");
  }

  let tabUrl = activeTab?.url ?? "";
  let windowId: number | undefined;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) tabUrl = tab.url;
    windowId = tab.windowId;
  } catch {
    // fallback
  }

  const settings = await getSettings().catch(() => null);
  const extraAllowlist = settings?.extraAllowlist ?? [];
  const urlClass = classifyUrl(tabUrl, extraAllowlist);

  if (urlClass === "sensitive") {
    return err("sensitive_page");
  }

  try {
    const dataUrl =
      typeof windowId === "number"
        ? await chrome.tabs.captureVisibleTab(windowId, { format: "png" })
        : await chrome.tabs.captureVisibleTab({ format: "png" });

    if (!dataUrl) {
      return err("generic", "Capture returned empty image.");
    }
    return ok({ dataUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Capture failed.";
    return err("generic", message);
  }
}

async function forwardToContent<T>(
  message: Envelope,
  requireAllowlist = false,
): Promise<Result<T>> {
  const activeTab = (await refreshActiveTab()) ?? getTrackedTab();
  const tabId = message.tabId ?? activeTab?.tabId;

  if (!tabId) {
    return err("generic", "No active tab is available.");
  }

  let tabUrl = activeTab?.url ?? "";
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
      tabUrl = tab.url;
    }
  } catch {
    // Keep activeTab url if chrome.tabs.get fails
  }

  const settings = await getSettings().catch(() => null);
  const extraAllowlist = settings?.extraAllowlist ?? [];

  // Security gate (architecture §6.2 & §8.1):
  const urlClass = classifyUrl(tabUrl, extraAllowlist);
  if (urlClass === "sensitive") {
    return err("sensitive_page");
  }

  if (requireAllowlist && urlClass !== "allowlisted") {
    return err("not_allowlisted");
  }

  try {
    const result = (await chrome.tabs.sendMessage(
      tabId,
      message,
    )) as Result<T>;
    return result;
  } catch {
    // If the tab was loaded before extension start, inject content script once
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/content/index.ts"],
      });
      const retryResult = (await chrome.tabs.sendMessage(
        tabId,
        message,
      )) as Result<T>;
      return retryResult;
    } catch {
      return err("generic", "Could not connect to the current tab.");
    }
  }
}

async function handlePageAct(message: Envelope): Promise<Result<unknown>> {
  const payload = message.payload as ActPayload | undefined;
  if (!payload) {
    return err("generic", "Missing action payload.");
  }

  // 1. Step limit gate (architecture §8.4 & Slice 12 step 6)
  if (
    typeof payload.stepIndex === "number" &&
    payload.stepIndex >= LIMITS.agentMaxSteps
  ) {
    return err("step_limit");
  }

  // 2. Recorded approval ID gate (architecture §8.4 & Slice 12):
  // page/act is refused unless the panel recorded an Approve for this exact proposal id
  const agentRun = await getAgentRun().catch(() => null);
  if (
    !payload.proposalId ||
    !agentRun?.approvedProposalId ||
    agentRun.approvedProposalId !== payload.proposalId
  ) {
    return err("generic", "Unapproved action proposal.");
  }

  // 3. Allowlist gate: execution requires allowlisted host (requireAllowlist = true)
  const result = await forwardToContent(message, true);

  // Clear approved proposal id after execution
  if (agentRun) {
    agentRun.approvedProposalId = null;
    await setAgentRun(agentRun).catch(() => { });
  }

  return result;
}

export function startMessaging(): void {
  chrome.runtime.onMessage.addListener(
    (message: Envelope, _sender, sendResponse) => {
      void (async () => {
        try {
          if (!message || message.v !== 1 || !message.cmd) {
            sendResponse(err("generic", "Invalid message envelope."));
            return;
          }

          switch (message.cmd) {
            case "panel/ready":
              sendResponse(await handlePanelReady());
              break;
            case "tab/getActive":
              sendResponse(await handleGetActiveTab());
              break;
            case "capture/visible":
              sendResponse(await handleCaptureVisible(message.tabId));
              break;
            case "page/extract":
              sendResponse(await forwardToContent(message, false));
              break;
            case "page/selection":
              sendResponse(await forwardToContent(message, false));
              break;
            case "page/scan":
              sendResponse(await forwardToContent(message, false));
              break;
            case "page/highlight":
              sendResponse(await forwardToContent(message, false));
              break;
            case "page/act":
              sendResponse(await handlePageAct(message));
              break;
            case "page/seek":
              sendResponse(await forwardToContent(message, false));
              break;
            default:
              sendResponse(
                err("generic", `Command not implemented: ${message.cmd}`),
              );
          }
        } catch (e) {
          const detail = e instanceof Error ? e.message : "Unknown error";
          sendResponse(err("generic", detail));
        }
      })();
      return true;
    },
  );
}
