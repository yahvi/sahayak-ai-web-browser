import {
  err,
  newEnvelopeId,
  type CommandName,
  type Envelope,
  type Result,
} from "../../shared/protocol";

export async function sendCommand<T>(
  cmd: CommandName,
  payload?: unknown,
  tabId?: number,
): Promise<Result<T>> {
  const envelope: Envelope = {
    v: 1,
    id: newEnvelopeId(),
    cmd,
    tabId,
    payload,
  };

  try {
    const response = (await chrome.runtime.sendMessage(envelope)) as Result<T>;
    if (!response || typeof response !== "object" || !("ok" in response)) {
      return err("generic", "Empty response from background.");
    }
    return response;
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Messaging failed.";
    return err("generic", detail);
  }
}
