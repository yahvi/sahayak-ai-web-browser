import { useState } from "react";
import { generateJson } from "../../ai/client";
import { parseFindIt, type FindItResult } from "../../ai/parse";
import { buildPrompt } from "../../ai/prompts";
import {
  ERROR_MESSAGES,
  type ActionMapData,
  type ActionNode,
  type ErrorCode,
} from "../../shared/protocol";
import type { UrlClass } from "../../shared/safety-policy";
import { getSettings } from "../../shared/storage";
import { sendCommand } from "../lib/messaging";
import { ActionMap } from "./action-map";
import { ActionLogViewer } from "./action-log";
import { AgentView } from "./agent";

interface ActViewProps {
  tabUrl?: string;
  urlClass?: UrlClass | null;
  onOpenSettings?: () => void;
}

export function ActView({ tabUrl, urlClass, onOpenSettings }: ActViewProps) {
  const [loading, setLoading] = useState(false);
  const [actionMap, setActionMap] = useState<ActionNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<ActionNode | null>(null);
  const [error, setError] = useState<{ code: ErrorCode; message: string } | null>(
    null,
  );
  const [findGoal, setFindGoal] = useState("");
  const [finding, setFinding] = useState(false);
  const [findReason, setFindReason] = useState<string | null>(null);
  const [logRefreshTrigger, setLogRefreshTrigger] = useState(0);

  const isSensitive = urlClass === "sensitive";

  async function handleScan() {
    if (isSensitive) {
      setError({
        code: "sensitive_page",
        message: ERROR_MESSAGES.sensitive_page,
      });
      return;
    }

    setLoading(true);
    setError(null);
    setSelectedNode(null);

    const res = await sendCommand<ActionMapData>("page/scan");
    setLoading(false);

    if (res.ok) {
      setActionMap(res.data.elements);
    } else {
      setError(res.error);
    }
  }

  async function handleHighlight(n: number) {
    if (isSensitive) return;
    const node = actionMap.find((item) => item.n === n) ?? null;
    setSelectedNode(node);
    await sendCommand("page/highlight", { n });
  }

  async function handleFindIt(e: React.FormEvent) {
    e.preventDefault();
    if (isSensitive) {
      setError({
        code: "sensitive_page",
        message: ERROR_MESSAGES.sensitive_page,
      });
      return;
    }
    if (!findGoal.trim() || finding) return;

    setFinding(true);
    setError(null);
    setFindReason(null);

    const scanRes = await sendCommand<ActionMapData>("page/scan");
    if (!scanRes.ok) {
      setFinding(false);
      setError(scanRes.error);
      return;
    }

    const elements = scanRes.data.elements;
    setActionMap(elements);

    if (elements.length === 0) {
      setFinding(false);
      setFindReason("No interactive elements were found on this page.");
      return;
    }

    const settings = await getSettings().catch(() => null);
    const language = settings?.language ?? "en";

    const mapSummary = elements
      .map(
        (el) =>
          `[${el.n}] ${el.role} "${el.name}"${el.type && el.type !== el.role ? ` (${el.type})` : ""}${el.valuePreview ? ` value="${el.valuePreview}"` : ""}${el.protected ? " [PROTECTED]" : ""}`,
      )
      .join("\n");

    const prompt = buildPrompt({
      task: "find_it",
      language,
      page: `Numbered interactive elements currently visible on this page:\n${mapSummary}`,
      userText: findGoal.trim(),
    });

    const validNumbers = new Set(elements.map((el) => el.n));

    const res = await generateJson<FindItResult>({
      prompt,
      task: "find_it",
      parse: (raw) => parseFindIt(raw, validNumbers),
    });

    setFinding(false);

    if (res.ok) {
      const { element, reason } = res.data;
      if (element !== null) {
        setFindReason(reason || `Found element [${element}].`);
        const targetNode = elements.find((item) => item.n === element) ?? null;
        setSelectedNode(targetNode);
        await sendCommand("page/highlight", { n: element });
      } else {
        setFindReason(reason || "That is not on this page.");
      }
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="act-view">
      {isSensitive ? (
        <div className="sensitive-warning-banner" role="alert" style={{ marginBottom: 4 }}>
          🛡️ <strong>Sensitive Page:</strong> Element scanning and autonomous actions are disabled on banking, payment, or private pages.
        </div>
      ) : null}

      {/* 1. Autonomous Agent Loop with Approval Gate (Slice 12 & 13) */}
      <section className="act-section">
        <div className="section-title">Autonomous Agent</div>
        <AgentView
          onOpenSettings={onOpenSettings}
          onElementsUpdated={(els) => setActionMap(els)}
          onLogUpdated={() => setLogRefreshTrigger((c) => c + 1)}
          isSensitive={isSensitive}
        />
        <ActionLogViewer refreshTrigger={logRefreshTrigger} />
      </section>

      <hr className="divider" />

      {/* 2. Structured Element Finder (Slice 11) */}
      <section className="act-section">
        <div className="section-title">Find on Page</div>
        <form className="find-box" onSubmit={handleFindIt}>
          <input
            type="text"
            className="find-input"
            placeholder={
              isSensitive
                ? "Find-it disabled on sensitive pages"
                : 'e.g. "where is submit button"'
            }
            value={findGoal}
            onChange={(e) => setFindGoal(e.target.value)}
            disabled={finding || isSensitive}
          />
          <button
            type="submit"
            className="find-btn"
            disabled={finding || !findGoal.trim() || isSensitive}
          >
            {finding ? "Locating…" : "Find it"}
          </button>
        </form>

        {findReason ? (
          <div className="find-result-box" role="status">
            <strong>Sahayak:</strong> {findReason}
          </div>
        ) : null}
      </section>

      <hr className="divider" />

      {/* 3. Interactive Element Scanner & Map (Slice 10) */}
      <section className="act-section">
        <div className="act-toolbar">
          <span className="section-title">Interactive Elements</span>
          <button
            type="button"
            className="act-scan-btn secondary"
            onClick={handleScan}
            disabled={loading || isSensitive}
          >
            {loading
              ? "Scanning…"
              : actionMap.length > 0
                ? "Re-scan"
                : "Scan page"}
          </button>
        </div>

        {error ? (
          <div className="empty" role="alert">
            <p>{error.message}</p>
            {error.code === "missing_key" && onOpenSettings ? (
              <div style={{ marginTop: 8 }}>
                <button type="button" onClick={onOpenSettings}>
                  Open Settings
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <ActionMap
          elements={actionMap}
          selectedN={selectedNode?.n}
          onHighlight={handleHighlight}
          loading={loading}
        />
      </section>
    </div>
  );
}
