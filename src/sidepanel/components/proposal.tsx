import type { Proposal } from "../../shared/protocol";

export interface ProposalCardProps {
  proposal: Proposal;
  onApprove: () => void;
  onConfirmConsequential?: () => void;
  onSkip: () => void;
  onStop: () => void;
  isExecuting?: boolean;
  needsExtraConfirm?: boolean;
  isDryRun?: boolean;
}

export function ProposalCard({
  proposal,
  onApprove,
  onConfirmConsequential,
  onSkip,
  onStop,
  isExecuting = false,
  needsExtraConfirm = false,
  isDryRun = false,
}: ProposalCardProps) {
  const { step, targetName, targetRole, stepIndex, isProtected, isConsequential } = proposal;
  const isDone = step.type === "done";
  const requiresDoubleConfirm = needsExtraConfirm || (isConsequential && needsExtraConfirm);

  return (
    <div className={`proposal-card ${requiresDoubleConfirm ? "consequential" : ""} ${isDryRun ? "dry-run-card" : ""}`}>
      <div className="proposal-card-header">
        <span className="step-tag">Step {stepIndex + 1}</span>
        <span className={`action-type-badge ${step.type}`}>
          {step.type.toUpperCase()}
        </span>
        {isDryRun ? (
          <span className="badge dry-run-badge">Dry-Run</span>
        ) : null}
        {isProtected ? (
          <span className="badge protected-badge">Protected</span>
        ) : null}
      </div>

      <div className="proposal-card-body">
        {isDone ? (
          <div className="proposal-summary">
            <strong>Goal Completed:</strong> All required actions finished.
          </div>
        ) : (
          <div className="proposal-summary">
            <strong>Action:</strong> {step.type.toUpperCase()}{" "}
            {step.value ? (
              <span className="proposal-value">“{step.value}”</span>
            ) : null}{" "}
            {step.element ? (
              <span className="proposal-target">
                on [{step.element}] {targetRole ? `${targetRole} ` : ""}
                <em>"{targetName || `Element #${step.element}`}"</em>
              </span>
            ) : null}
          </div>
        )}

        <div className="proposal-reason">
          <span className="muted">Reason:</span> {step.reason}
        </div>

        {requiresDoubleConfirm ? (
          <div className="consequential-warning" role="alert">
            <strong>⚠️ Extra Confirmation Required:</strong>
            <p>This looks like Submit, Pay, or Send. Confirm again to continue.</p>
          </div>
        ) : null}
      </div>

      <div className="proposal-card-actions">
        {requiresDoubleConfirm ? (
          <button
            type="button"
            className="approve-btn confirm-btn"
            onClick={onConfirmConsequential ?? onApprove}
            disabled={isExecuting}
          >
            {isExecuting
              ? "Simulating…"
              : isDryRun
                ? "Confirm (Highlight only)"
                : "Confirm & Execute"}
          </button>
        ) : (
          <button
            type="button"
            className={`approve-btn ${isDryRun ? "dry-run-btn" : ""}`}
            onClick={onApprove}
            disabled={isExecuting}
          >
            {isExecuting
              ? "Simulating…"
              : isDone
                ? "Approve Done"
                : isDryRun
                  ? "Approve (Highlight only)"
                  : "Approve"}
          </button>
        )}

        <button
          type="button"
          className="skip-btn"
          onClick={onSkip}
          disabled={isExecuting}
          title="Skip this element and ask the model for a different next action"
        >
          Skip
        </button>

        <button
          type="button"
          className="stop-btn"
          onClick={onStop}
          title="Stop agent run immediately"
        >
          Stop
        </button>
      </div>
    </div>
  );
}

