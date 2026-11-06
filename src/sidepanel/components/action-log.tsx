import { useEffect, useState } from "react";
import type { ActionLogSession } from "../../shared/protocol";
import { clearActionLogs, getAllActionLogs } from "../../shared/storage";

interface ActionLogViewerProps {
  currentSessionId?: string | null;
  refreshTrigger?: number;
}

export function ActionLogViewer({
  currentSessionId,
  refreshTrigger = 0,
}: ActionLogViewerProps) {
  const [sessions, setSessions] = useState<ActionLogSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const logs = await getAllActionLogs();
        if (!cancelled) {
          setSessions(logs);
          if (logs.length > 0 && !selectedSessionId) {
            setSelectedSessionId(currentSessionId ?? logs[0].sessionId);
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSessionId, refreshTrigger]);

  const activeSession =
    sessions.find((s) => s.sessionId === selectedSessionId) ??
    sessions[0] ??
    null;

  async function handleClearLogs() {
    await clearActionLogs();
    setSessions([]);
    setSelectedSessionId(null);
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  return (
    <div className="action-log-container">
      <div className="action-log-header">
        <button
          type="button"
          className="action-log-toggle"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
        >
          <span className="toggle-icon">{isOpen ? "▼" : "▶"}</span>
          <strong>Action Log</strong>
          {sessions.length > 0 ? (
            <span className="log-count-badge">
              {activeSession ? activeSession.entries.length : 0} steps
            </span>
          ) : null}
        </button>

        {sessions.length > 0 ? (
          <button
            type="button"
            className="action-log-clear-btn"
            onClick={handleClearLogs}
            title="Clear all action logs"
          >
            Clear
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div className="action-log-body">
          {sessions.length === 0 ? (
            <p className="action-log-empty">
              No actions logged yet. Start an agent run or dry-run to see decisions here.
            </p>
          ) : (
            <>
              {sessions.length > 1 ? (
                <div className="session-selector-row">
                  <label htmlFor="session-select" className="muted" style={{ fontSize: "0.8rem" }}>
                    Session:
                  </label>
                  <select
                    id="session-select"
                    className="session-select"
                    value={activeSession?.sessionId ?? ""}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                  >
                    {sessions.map((s, idx) => (
                      <option key={s.sessionId} value={s.sessionId}>
                        {s.goal ? `"${s.goal.slice(0, 30)}…"` : `Session ${idx + 1}`} ({s.entries.length} steps)
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {activeSession ? (
                <div className="session-details">
                  <div className="session-meta">
                    <span className="session-goal">
                      <strong>Goal:</strong> {activeSession.goal}
                    </span>
                    <span className={`session-status-badge ${activeSession.status}`}>
                      {activeSession.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="log-entries-list">
                    {activeSession.entries.map((entry) => (
                      <div key={entry.id} className={`log-entry-item decision-${entry.decision}`}>
                        <div className="entry-header">
                          <span className="entry-step">Step {entry.stepIndex + 1}</span>
                          <span className={`entry-type-badge ${entry.type}`}>
                            {entry.type.toUpperCase()}
                          </span>
                          <span className={`decision-badge ${entry.decision}`}>
                            {entry.decision === "dry_run" ? "DRY RUN" : entry.decision.toUpperCase()}
                          </span>
                          <span className="entry-time">{formatTime(entry.timestamp)}</span>
                        </div>

                        {entry.target ? (
                          <div className="entry-target">
                            <span className="muted">Target:</span> {entry.target}
                            {entry.value ? (
                              <span className="entry-value"> = “{entry.value}”</span>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="entry-reason">
                          <span className="muted">Reason:</span> {entry.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

