/**
 * Content-script entry and command dispatcher.
 * Handles page extraction, scanning, highlighting, video seeking, and execution.
 */

import { err, ok, type ActPayload, type Envelope } from "../shared/protocol";
import { executeAct } from "./act";
import { extractPage } from "./extract";
import { clearOverlays, highlightElement, renderOverlays } from "./overlay";
import { scanElements } from "./scan";
import { getPageSelection } from "./selection";

chrome.runtime.onMessage.addListener((message: Envelope, _sender, sendResponse) => {
  if (!message || message.v !== 1) {
    sendResponse(err("generic", "Invalid message envelope."));
    return false;
  }

  switch (message.cmd) {
    case "page/extract": {
      try {
        const pageData = extractPage(document);
        sendResponse(ok(pageData));
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Extraction failed.";
        sendResponse(err("generic", detail));
      }
      return false;
    }

    case "page/selection": {
      try {
        const text = getPageSelection(document);
        sendResponse(ok({ text }));
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Selection extraction failed.";
        sendResponse(err("generic", detail));
      }
      return false;
    }

    case "page/scan": {
      try {
        const elements = scanElements(document);
        renderOverlays(document);
        sendResponse(
          ok({
            url: window.location.href,
            elements,
          }),
        );
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Page scan failed.";
        sendResponse(err("generic", detail));
      }
      return false;
    }

    case "page/highlight": {
      try {
        const payload = message.payload as { n: number } | undefined;
        if (!payload || typeof payload.n !== "number") {
          sendResponse(err("generic", "Element number required."));
          return false;
        }
        const success = highlightElement(payload.n);
        if (success) {
          sendResponse(ok({ highlighted: payload.n }));
        } else {
          sendResponse(err("generic", `Could not find element [${payload.n}].`));
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Highlight failed.";
        sendResponse(err("generic", detail));
      }
      return false;
    }

    case "page/act": {
      try {
        const payload = message.payload as ActPayload | undefined;
        if (!payload) {
          sendResponse(err("generic", "Action payload missing."));
          return false;
        }

        const res = executeAct(payload, document);
        sendResponse(res);
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Action failed.";
        sendResponse(err("generic", detail));
      }
      return false;
    }

    case "page/seek": {
      try {
        const payload = message.payload as { seconds: number } | undefined;
        if (payload && typeof payload.seconds === "number") {
          const video = document.querySelector("video");
          if (video) {
            video.currentTime = payload.seconds;
            video.play().catch(() => {});
            sendResponse(ok({ seeked: true, seconds: payload.seconds }));
            return false;
          }
        }
        sendResponse(err("generic", "No video player found on page."));
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Seek failed.";
        sendResponse(err("generic", detail));
      }
      return false;
    }

    default:
      sendResponse(
        err("generic", `Content command not implemented yet: ${String(message.cmd)}`),
      );
      return false;
  }
});

// Clear overlays when user unloads or navigates
window.addEventListener("beforeunload", () => {
  clearOverlays(document);
});
