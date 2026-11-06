import { useEffect, useState } from "react";
import { generateJson } from "../../ai/client";
import { parseAgentStep } from "../../ai/parse";
import { buildPrompt } from "../../ai/prompts";
import { LIMITS } from "../../shared/limits";
import {
  ERROR_MESSAGES,
  type ActionMapData,
  type ActionNode,
  type AgentRunState,
  type AgentRunStatus,
  type AgentStep,
  type ErrorCode,
  type Proposal,
  type Skill,
} from "../../shared/protocol";
import { classifyUrl, isConsequentialName } from "../../shared/safety-policy";
import {
  appendActionLogEntry,
  clearAgentRun,
  getAgentRun,
  getProfile,
  getSettings,
  recordApprovedProposal,
  setAgentRun,
} from "../../shared/storage";
import { sendCommand } from "../lib/messaging";
import { ProposalCard } from "./proposal";
import { SkillsRow } from "./skills-row";

interface AgentViewProps {
  onOpenSettings?: () => void;
  onElementsUpdated?: (elements: ActionNode[]) => void;
  onLogUpdated?: () => void;
  isSensitive?: boolean;
}

export function AgentView({
  onOpenSettings,
  onElementsUpdated,
  onLogUpdated,
  isSensitive = false,
}: AgentViewProps) {
  const [goal, setGoal] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [status, setStatus] = useState<AgentRunStatus>("idle");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [skippedElements, setSkippedElements] = useState<number[]>([]);
  const [needsExtraConfirm, setNeedsExtraConfirm] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [error, setError] = useState<{ code: ErrorCode; message: string } | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Restore run state and settings on mount (architecture §11.4 & Slice 13)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await getSettings().catch(() => null);
        if (settings && !cancelled) {
          setDryRun(settings.dryRunDefault ?? false);
        }

        const saved = await getAgentRun();
        if (cancelled || !saved) return;

        if (saved.status === "waiting_approval" && saved.lastProposal) {
          setActiveRunId(saved.runId);
          setGoal(saved.goal);
          setStepIndex(saved.stepIndex);
          setStatus(saved.status);
          setProposal(saved.lastProposal);
          setSkippedElements(saved.skippedElements ?? []);
          if (saved.dryRun !== undefined) {
            setDryRun(saved.dryRun);
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startAgent(e: React.FormEvent) {
    e.preventDefault();
    if (isSensitive || !goal.trim() || status === "scanning" || status === "thinking" || status === "executing") {
      return;
    }

    setError(null);
    setStatusMessage(null);
    setProposal(null);
    setNeedsExtraConfirm(false);
    const runId = crypto.randomUUID();
    setActiveRunId(runId);
    setStepIndex(0);
    setSkippedElements([]);

    await runStep(runId, 0, []);
  }

  async function runStep(
    runId: string,
    currentStepIndex: number,
    skipped: number[],
  ) {
    // Step limit check (Slice 12 step 6)
    if (currentStepIndex >= LIMITS.agentMaxSteps) {
      setError({
        code: "step_limit",
        message: ERROR_MESSAGES.step_limit,
      });
      setStatus("error");
      await clearAgentRun();
      return;
    }

    // 1. Scan page (architecture §11.3)
    setStatus("scanning");
    setStatusMessage(`Step ${currentStepIndex + 1}: Scanning page controls…`);

    const scanRes = await sendCommand<ActionMapData>("page/scan");
    if (!scanRes.ok) {
      setError(scanRes.error);
      setStatus("error");
      setStatusMessage(null);
      await clearAgentRun();
      return;
    }

    const elements = scanRes.data.elements;
    onElementsUpdated?.(elements);

    if (elements.length === 0) {
      setError({
        code: "off_page",
        message: "No interactive elements found on this page.",
      });
      setStatus("error");
      setStatusMessage(null);
      await clearAgentRun();
      return;
    }

    // 2. Build prompt for model
    setStatus("thinking");
    setStatusMessage(`Step ${currentStepIndex + 1}: Thinking of next action…`);

    const settings = await getSettings().catch(() => null);
    const profile = await getProfile().catch(() => null);
    const language = settings?.language ?? "en";

    const activeTab = await sendCommand<{ url: string }>("tab/getActive").catch(() => null);
    const currentTabUrl = activeTab?.ok ? activeTab.data.url : "";
    const extraAllowlist = settings?.extraAllowlist ?? [];
    const isSensitive = currentTabUrl ? classifyUrl(currentTabUrl, extraAllowlist) === "sensitive" : false;

    const mapSummary = elements
      .map(
        (el) =>
          `[${el.n}] ${el.role} "${el.name}"${el.type && el.type !== el.role ? ` (${el.type})` : ""}${el.valuePreview ? ` value="${el.valuePreview}"` : ""}${el.protected ? " [PROTECTED]" : ""}`,
      )
      .join("\n");

    let pageContext = `List of numbered interactive elements currently on the page:\n${mapSummary}`;
    if (skipped.length > 0) {
      pageContext += `\n\nNOTE: Elements [${skipped.join(", ")}] were skipped by the user. Do NOT select or interact with them. Propose a different next action.`;
    }

    const prompt = buildPrompt({
      task: "agent_act",
      language,
      page: pageContext,
      profile: isSensitive ? null : profile,
      isSensitive,
      userText: `GOAL: ${goal.trim()}\nCURRENT STEP: ${currentStepIndex + 1} of ${LIMITS.agentMaxSteps}. Propose exactly ONE next action as raw JSON.`,
    });

    const validNumbers = new Set(elements.map((el) => el.n));

    // 3. Call model with JSON repair hook (re-ask once, escalate to Flash once)
    const res = await generateJson<AgentStep>({
      prompt,
      task: "agent_act",
      parse: (raw) => parseAgentStep(raw, validNumbers),
    });

    if (!res.ok) {
      setError(res.error);
      setStatus("error");
      setStatusMessage(null);
      await clearAgentRun();
      return;
    }

    const step = res.data;
    const targetNode = step.element
      ? elements.find((e) => e.n === step.element) ?? null
      : null;

    const isConsequential = targetNode
      ? isConsequentialName(targetNode.name || "")
      : false;

    const newProposal: Proposal = {
      id: crypto.randomUUID(),
      runId,
      stepIndex: currentStepIndex,
      step,
      targetName: targetNode?.name,
      targetRole: targetNode?.role,
      isConsequential,
      isProtected: targetNode?.protected,
    };

    setProposal(newProposal);
    setNeedsExtraConfirm(false);
    setStatus("waiting_approval");
    setStatusMessage(null);

    // Highlight target element on the page if present
    if (step.element) {
      await sendCommand("page/highlight", { n: step.element });
    }

    // Persist in session storage across service-worker sleep (architecture §11.4 & Slice 13)
    const runState: AgentRunState = {
      runId,
      goal,
      tabId: 0,
      stepIndex: currentStepIndex,
      status: "waiting_approval",
      lastProposal: newProposal,
      approvedProposalId: null,
      skippedElements: skipped,
      dryRun,
    };
    await setAgentRun(runState);
  }

  async function handleApprove() {
    if (!proposal || !activeRunId) return;

    // Gate: type on protected field is blocked
    if (proposal.isProtected && proposal.step.type === "type") {
      setError({
        code: "protected_field",
        message: ERROR_MESSAGES.protected_field,
      });
      setStatus("error");

      await appendActionLogEntry(
        activeRunId,
        goal,
        {
          stepIndex: proposal.stepIndex,
          type: proposal.step.type,
          target: proposal.step.element
            ? `[${proposal.step.element}] ${proposal.targetRole ?? ""} "${proposal.targetName ?? ""}"`.trim()
            : undefined,
          reason: `${proposal.step.reason} (Blocked: password/protected field)`,
          decision: "blocked",
        },
        "error",
      );
      onLogUpdated?.();
      await clearAgentRun();
      return;
    }

    // Gate: consequential names require second confirm
    if (proposal.isConsequential && !needsExtraConfirm) {
      setNeedsExtraConfirm(true);
      return;
    }

    await executeApprovedProposal(false);
  }

  async function handleConfirmConsequential() {
    await executeApprovedProposal(true);
  }

  async function executeApprovedProposal(confirmedConsequential: boolean) {
    if (!proposal || !activeRunId) return;

    setStatus("executing");

    // DRY-RUN BRANCH (architecture §8.4 & Slice 13 step 2)
    if (dryRun) {
      setStatusMessage(
        `[Dry-Run] Step ${stepIndex + 1}: Highlighted ${proposal.step.type.toUpperCase()}${
          proposal.step.element ? ` on [${proposal.step.element}]` : ""
        } (simulated; no DOM mutation)`,
      );

      // Call page/highlight only
      if (proposal.step.element) {
        await sendCommand("page/highlight", { n: proposal.step.element });
      }

      // Append to action log with decision: "dry_run"
      await appendActionLogEntry(
        activeRunId,
        goal,
        {
          stepIndex: proposal.stepIndex,
          type: proposal.step.type,
          target: proposal.step.element
            ? `[${proposal.step.element}] ${proposal.targetRole ?? ""} "${proposal.targetName ?? ""}"`.trim()
            : undefined,
          value: proposal.isProtected ? "[PROTECTED]" : proposal.step.value,
          reason: proposal.step.reason,
          decision: "dry_run",
        },
        proposal.step.type === "done" ? "done" : "waiting_approval",
      );
      onLogUpdated?.();

      if (proposal.step.type === "done") {
        setStatus("done");
        setStatusMessage("[Dry-Run] Goal completed! All steps simulated.");
        setProposal(null);
        await clearAgentRun();
        return;
      }

      setNeedsExtraConfirm(false);
      setProposal(null);

      // Brief delay for visual feedback before advancing
      await new Promise((resolve) => setTimeout(resolve, 800));

      const nextStepIndex = stepIndex + 1;
      setStepIndex(nextStepIndex);
      await runStep(activeRunId, nextStepIndex, []);
      return;
    }

    // NORMAL EXECUTION BRANCH
    setStatusMessage(`Step ${stepIndex + 1}: Executing approved action…`);
    setError(null);

    // Record approval in session storage for worker verification (architecture §8.4)
    await recordApprovedProposal(proposal.id);

    // Send page/act
    const actRes = await sendCommand<{ executed: boolean; n?: number; type: string }>(
      "page/act",
      {
        proposalId: proposal.id,
        runId: proposal.runId,
        stepIndex: proposal.stepIndex,
        n: proposal.step.element,
        type: proposal.step.type,
        value: proposal.step.value,
        confirmedConsequential,
      },
    );

    if (!actRes.ok) {
      setError(actRes.error);
      setStatus("error");
      setStatusMessage(null);

      await appendActionLogEntry(
        activeRunId,
        goal,
        {
          stepIndex: proposal.stepIndex,
          type: proposal.step.type,
          target: proposal.step.element
            ? `[${proposal.step.element}] ${proposal.targetRole ?? ""} "${proposal.targetName ?? ""}"`.trim()
            : undefined,
          value: proposal.isProtected ? "[PROTECTED]" : proposal.step.value,
          reason: `${proposal.step.reason} (Blocked: ${actRes.error.message})`,
          decision: "blocked",
        },
        "error",
      );
      onLogUpdated?.();
      await clearAgentRun();
      return;
    }

    // Action successfully executed
    await appendActionLogEntry(
      activeRunId,
      goal,
      {
        stepIndex: proposal.stepIndex,
        type: proposal.step.type,
        target: proposal.step.element
          ? `[${proposal.step.element}] ${proposal.targetRole ?? ""} "${proposal.targetName ?? ""}"`.trim()
          : undefined,
        value: proposal.isProtected ? "[PROTECTED]" : proposal.step.value,
        reason: proposal.step.reason,
        decision: "approved",
      },
      proposal.step.type === "done" ? "done" : "waiting_approval",
    );
    onLogUpdated?.();

    // If done action executed, finish the run
    if (proposal.step.type === "done") {
      setStatus("done");
      setStatusMessage("Goal achieved! All proposed actions completed.");
      setProposal(null);
      await clearAgentRun();
      return;
    }

    setNeedsExtraConfirm(false);
    setProposal(null);

    // Wait 500ms for DOM reaction before scanning next step
    await new Promise((resolve) => setTimeout(resolve, 500));

    const nextStepIndex = stepIndex + 1;
    setStepIndex(nextStepIndex);
    await runStep(activeRunId, nextStepIndex, []);
  }

  async function handleSkip() {
    if (!proposal || !activeRunId) return;

    const elementToSkip = proposal.step.element;
    const nextSkipped = elementToSkip
      ? [...skippedElements, elementToSkip]
      : skippedElements;

    await appendActionLogEntry(
      activeRunId,
      goal,
      {
        stepIndex: proposal.stepIndex,
        type: proposal.step.type,
        target: proposal.step.element
          ? `[${proposal.step.element}] ${proposal.targetRole ?? ""} "${proposal.targetName ?? ""}"`.trim()
          : undefined,
        reason: proposal.step.reason,
        decision: "skipped",
      },
      "waiting_approval",
    );
    onLogUpdated?.();

    setSkippedElements(nextSkipped);
    setProposal(null);
    setNeedsExtraConfirm(false);

    await runStep(activeRunId, stepIndex, nextSkipped);
  }

  async function handleStop() {
    if (activeRunId && proposal) {
      await appendActionLogEntry(
        activeRunId,
        goal,
        {
          stepIndex: proposal.stepIndex,
          type: proposal.step.type,
          target: proposal.step.element
            ? `[${proposal.step.element}] ${proposal.targetRole ?? ""} "${proposal.targetName ?? ""}"`.trim()
            : undefined,
          reason: proposal.step.reason,
          decision: "stopped",
        },
        "stopped",
      );
      onLogUpdated?.();
    }

    setStatus("stopped");
    setStatusMessage("Agent run stopped by user.");
    setProposal(null);
    setNeedsExtraConfirm(false);
    setError(null);
    await clearAgentRun();
    await sendCommand("page/scan").catch(() => {});
  }

  const isRunning =
    status === "scanning" || status === "thinking" || status === "executing";

  return (
    <div className="agent-container" aria-label="Sahayak Autonomous Agent">
      {/* Dry-run Toggle Row (Slice 13) */}
      <div className="agent-options-row">
        <label className="dry-run-label" title="Dry-run highlights matching controls without executing clicks or typing.">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={isRunning || status === "waiting_approval" || isSensitive}
          />
          <span className="dry-run-text">
            <strong>Dry-run mode</strong> (highlights only, no clicks or typing)
          </span>
        </label>
      </div>

      <SkillsRow
        onSelectSkill={(skill) => {
          if (!isRunning && status !== "waiting_approval" && !isSensitive) {
            setGoal(skill.prompt);
          }
        }}
      />

      <form className="agent-goal-form" onSubmit={startAgent}>
        <div className="agent-input-row">
          <input
            type="text"
            className="agent-goal-input"
            placeholder={
              isSensitive
                ? "Browser actions are disabled on sensitive pages"
                : 'Agent goal e.g. "Fill form with my name and email"'
            }
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={isRunning || status === "waiting_approval" || isSensitive}
          />
          <button
            type="submit"
            className="agent-run-btn"
            disabled={
              isRunning ||
              status === "waiting_approval" ||
              isSensitive ||
              !goal.trim()
            }
          >
            {isRunning ? "Running…" : dryRun ? "Dry-run Agent" : "Run Agent"}
          </button>
        </div>
      </form>

      {/* Persistent Kill Switch (architecture §8.5 & Slice 13 step 4) */}
      {isRunning || status === "waiting_approval" ? (
        <div className="agent-killswitch-row">
          <button
            type="button"
            className="killswitch-btn"
            onClick={handleStop}
            title="Emergency kill switch — stop the agent run immediately"
          >
            🛑 Stop Run (Kill Switch)
          </button>
        </div>
      ) : null}

      {statusMessage ? (
        <div className="agent-status-notice" role="status">
          <span className="typing-dots">
            <span />
            <span />
            <span />
          </span>
          <span>{statusMessage}</span>
        </div>
      ) : null}

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

      {proposal ? (
        <ProposalCard
          proposal={proposal}
          onApprove={handleApprove}
          onConfirmConsequential={handleConfirmConsequential}
          onSkip={handleSkip}
          onStop={handleStop}
          isExecuting={status === "executing"}
          needsExtraConfirm={needsExtraConfirm}
          isDryRun={dryRun}
        />
      ) : null}

      {status === "done" && !statusMessage ? (
        <div className="agent-done-notice">
          <strong>Goal Completed!</strong> All actions have finished.
        </div>
      ) : null}

      {status === "stopped" && !statusMessage ? (
        <div className="agent-stopped-notice">
          <strong>Agent Stopped.</strong> The run was cancelled by user.
        </div>
      ) : null}
    </div>
  );
}
