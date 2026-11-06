import type { ActionNode } from "../../shared/protocol";

export interface ActionMapProps {
  elements: ActionNode[];
  selectedN?: number | null;
  onHighlight?: (n: number) => void;
  loading?: boolean;
}

export function ActionMap({
  elements,
  selectedN,
  onHighlight,
  loading = false,
}: ActionMapProps) {
  if (loading) {
    return (
      <div className="action-map-loading">
        <p className="muted">Scanning page for interactive controls…</p>
      </div>
    );
  }

  if (elements.length === 0) {
    return (
      <div className="action-map-empty">
        <p className="muted">
          No elements scanned yet. Click <strong>Scan Page</strong> above to
          detect and badge interactive controls.
        </p>
      </div>
    );
  }

  return (
    <div className="action-map-container" aria-label="Interactive element map">
      <div className="action-map-header">
        <span className="action-map-count">
          {elements.length} interactive control{elements.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="action-map-list">
        {elements.map((node) => {
          const isSelected = selectedN === node.n;

          return (
            <li
              key={node.n}
              className={`action-map-item ${isSelected ? "selected" : ""}`}
              onClick={() => onHighlight?.(node.n)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onHighlight?.(node.n);
                }
              }}
            >
              <div className="action-map-item-header">
                <span className="action-badge-num">[{node.n}]</span>
                <span className="action-role-tag">
                  {node.role}
                  {node.type && node.type !== node.role ? ` (${node.type})` : ""}
                </span>
                {node.protected ? (
                  <span className="badge protected-badge">Protected</span>
                ) : null}
              </div>

              <div className="action-map-item-name" title={node.name}>
                {node.name || `Element #${node.n}`}
              </div>

              {node.valuePreview ? (
                <div className="action-map-item-value">
                  <span className="muted">value:</span> “{node.valuePreview}”
                </div>
              ) : null}

              <div className="action-map-item-actions">
                <button
                  type="button"
                  className="highlight-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onHighlight?.(node.n);
                  }}
                >
                  {isSelected ? "Highlighted" : "Highlight"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

