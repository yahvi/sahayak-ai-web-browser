import { useState } from "react";
import { generateText } from "../../ai/client";
import { buildPrompt } from "../../ai/prompts";
import { ERROR_MESSAGES, type ErrorCode } from "../../shared/protocol";

interface AskBoxProps {
  onOpenSettings?: () => void;
}

export function AskBox({ onOpenSettings }: AskBoxProps) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<{ code: ErrorCode; message: string } | null>(
    null,
  );

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const query = question.trim();
    if (!query || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    setReply(null);

    const fullPrompt = buildPrompt({
      task: "free_ask",
      userText: query,
    });

    const result = await generateText({
      prompt: fullPrompt,
      task: "free_ask",
    });

    setLoading(false);

    if (result.ok) {
      setReply(result.data);
    } else {
      setError(result.error);
    }
  }

  function handleReset() {
    setQuestion("");
    setReply(null);
    setError(null);
  }

  return (
    <div className="ask-box" data-testid="ask-box">
      <form onSubmit={handleAsk}>
        <label htmlFor="ask-input" className="ask-label">
          Ask Gemini
        </label>
        <textarea
          id="ask-input"
          className="ask-input"
          placeholder="Ask a question..."
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={loading}
          required
        />
        <div className="ask-actions">
          <button
            type="submit"
            className="ask-button"
            disabled={loading || !question.trim()}
          >
            {loading ? "Thinking…" : "Ask"}
          </button>
          {reply || error ? (
            <button
              type="button"
              className="ask-clear-button"
              onClick={handleReset}
              disabled={loading}
            >
              Clear
            </button>
          ) : null}
        </div>
      </form>

      {loading ? (
        <div className="status" role="status">
          Sahayak is thinking…
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

      {reply ? (
        <div className="ask-reply" role="region" aria-label="Gemini response">
          <div className="reply-header">Reply</div>
          <div className="reply-content">{reply}</div>
        </div>
      ) : null}
    </div>
  );
}

