import { useEffect, useState } from "react";
import { generateContentStream } from "../../ai/client";
import { buildPrompt, type ChatTurn } from "../../ai/prompts";
import { parseDataUrl } from "../../shared/image";
import { LIMITS } from "../../shared/limits";
import { GEMINI_MODELS, type TaskKind } from "../../shared/models";
import {
  ERROR_MESSAGES,
  type PageExtract,
  type PendingIntent,
  type PendingIntentKind,
  type Skill,
} from "../../shared/protocol";
import { classifyUrl } from "../../shared/safety-policy";
import { getProfile, getSettings } from "../../shared/storage";
import { sendCommand } from "../lib/messaging";
import { Cropper } from "./cropper";
import { SkillsRow } from "./skills-row";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
  isOffPage?: boolean;
}

interface ChatProps {
  tabId?: number;
  tabTitle?: string;
  tabUrl?: string;
  urlClass?: "sensitive" | "allowlisted" | "normal" | null;
  incomingIntent?: PendingIntent | null;
  onClearIntent?: () => void;
  onOpenSettings?: () => void;
}

const DEFAULT_WELCOME_MESSAGE: Message = {
  id: "init",
  role: "assistant",
  content:
    "Hi! Ask me anything about this page or video. I answer strictly grounded in the content.",
};

export function ChatView({
  tabId,
  tabTitle,
  tabUrl,
  urlClass,
  incomingIntent,
  onClearIntent,
  onOpenSettings,
}: ChatProps) {
  // Store transcripts keyed by tabId in React state (architecture §7.3 & Slice 6 step 4)
  const [transcriptsByTab, setTranscriptsByTab] = useState<
    Record<number, Message[]>
  >({});
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentExtract, setCurrentExtract] = useState<PageExtract | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [waitingStatus, setWaitingStatus] = useState<string | null>(null);
  const [capturedPngDataUrl, setCapturedPngDataUrl] = useState<string | null>(
    null,
  );

  const activeTabId = tabId ?? 0;
  const isSensitive =
    urlClass === "sensitive" ||
    (tabUrl ? classifyUrl(tabUrl) === "sensitive" : false);
  const messages = transcriptsByTab[activeTabId] ?? [DEFAULT_WELCOME_MESSAGE];

  const setMessagesForCurrentTab = (
    updater: (prev: Message[]) => Message[],
  ) => {
    setTranscriptsByTab((prev) => {
      const currentList = prev[activeTabId] ?? [DEFAULT_WELCOME_MESSAGE];
      return {
        ...prev,
        [activeTabId]: updater(currentList),
      };
    });
  };

  // Drop pending screenshot and fetch extract when activeTabId changes (Edge Case 8.5)
  useEffect(() => {
    setCapturedPngDataUrl(null);

    void (async () => {
      if (!activeTabId) return;
      const res = await sendCommand<PageExtract>(
        "page/extract",
        undefined,
        activeTabId,
      );
      if (res.ok) {
        setCurrentExtract(res.data);
      }
    })();
  }, [activeTabId]);

  /**
   * Executes a selection intent (Explain, Translate, Draft a reply)
   * from context menu or open panel (architecture §10.3 & Slice 7).
   */
  async function executeSelectionAction(intent: {
    kind: PendingIntentKind;
    selectionText: string;
    tabId?: number;
    url?: string;
    createdAt?: number;
  }) {
    if (loading) return;

    // 1. Drop if older than 2 minutes (Edge Case 7.2 & limits.ts)
    if (
      intent.createdAt &&
      Date.now() - intent.createdAt > LIMITS.pendingIntentTtlMs
    ) {
      return;
    }

    // 2. Drop if tab mismatch (Edge Case 7.8)
    if (intent.tabId && intent.tabId !== activeTabId) {
      return;
    }

    // 3. Selection check: Cap at 4,000 characters; ignore empty (Edge Cases 7.3, 7.4)
    const raw = intent.selectionText?.trim() ?? "";
    if (!raw) return;
    const cappedText =
      raw.length > LIMITS.selectionChars
        ? raw.slice(0, LIMITS.selectionChars)
        : raw;

    // 4. Sensitive URL check: Refuse before model call (Edge Cases 7.5, 149, 191)
    const checkUrl = intent.url || tabUrl || "";
    const settings = await getSettings().catch(() => null);
    const extraAllowlist = settings?.extraAllowlist ?? [];
    const urlClass = checkUrl ? classifyUrl(checkUrl, extraAllowlist) : null;

    const snippet =
      cappedText.length > 80 ? cappedText.slice(0, 77) + "…" : cappedText;

    let userLabel = "";
    if (intent.kind === "explain") {
      userLabel = `Explain: "${snippet}"`;
    } else if (intent.kind === "translate") {
      const targetLang = settings?.translateLanguage ?? "hi";
      const targetName = targetLang === "hi" ? "Hindi" : targetLang;
      userLabel = `Translate to ${targetName}: "${snippet}"`;
    } else {
      userLabel = `Draft a reply: "${snippet}"`;
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userLabel,
    };

    const assistantMsgId = crypto.randomUUID();

    if (urlClass === "sensitive") {
      const errorMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: ERROR_MESSAGES.sensitive_page,
        isError: true,
      };
      setMessagesForCurrentTab((prev) => [...prev, userMsg, errorMsg]);
      return;
    }

    const initialAssistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessagesForCurrentTab((prev) => [...prev, userMsg, initialAssistantMsg]);
    setLoading(true);
    setWaitingStatus(null);

    const language = settings?.language ?? "en";
    const targetLanguage = settings?.translateLanguage ?? "hi";

    let task: TaskKind = "explain";
    let userQuery =
      "Explain and simplify the selected text clearly and concisely.";

    if (intent.kind === "translate") {
      task = "translate";
      userQuery =
        "Translate the selected text accurately into the target language.";
    } else if (intent.kind === "draft") {
      task = "draft_reply";
      userQuery =
        "Draft a polite, professional, and well-structured reply to this message.";
    }

    const profile = await getProfile().catch(() => null);

    const prompt = buildPrompt({
      task,
      language,
      targetLanguage,
      page: cappedText,
      profile,
      isSensitive: false,
      userText: userQuery,
    });

    let accumulatedText = "";
    const streamResult = await generateContentStream(
      {
        prompt,
        task,
        model: GEMINI_MODELS.flashLite,
        onStatus: (status) => setWaitingStatus(status),
      },
      (token) => {
        accumulatedText += token;
        setMessagesForCurrentTab((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: accumulatedText } : m,
          ),
        );
      },
    );

    setLoading(false);

    if (streamResult.ok) {
      setMessagesForCurrentTab((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: streamResult.data, isStreaming: false }
            : m,
        ),
      );
    } else {
      setMessagesForCurrentTab((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: streamResult.error.message,
                isStreaming: false,
                isError: true,
              }
            : m,
        ),
      );
    }
  }

  // Handle incoming intent from context menus
  useEffect(() => {
    if (!incomingIntent) return;
    void executeSelectionAction(incomingIntent);
    onClearIntent?.();
  }, [incomingIntent]);

  /**
   * Panel's own "Explain selection" flow using page/selection (Slice 7 step 6).
   */
  async function handleExplainSelection() {
    setNotice(null);
    if (loading) return;

    const res = await sendCommand<{ text: string }>(
      "page/selection",
      undefined,
      activeTabId,
    );

    if (!res.ok) {
      if (res.error.code === "sensitive_page") {
        setMessagesForCurrentTab((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "user",
            content: "Explain selection",
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: ERROR_MESSAGES.sensitive_page,
            isError: true,
          },
        ]);
      } else {
        setNotice(res.error.message);
      }
      return;
    }

    const text = res.data?.text?.trim() ?? "";
    if (!text) {
      setNotice("No text selected. Highlight some text on the page first.");
      setTimeout(() => setNotice(null), 3500);
      return;
    }

    await executeSelectionAction({
      kind: "explain",
      selectionText: text,
      tabId: activeTabId,
      url: tabUrl,
      createdAt: Date.now(),
    });
  }

  /**
   * Initiates the Screenshot and Ask flow (Slice 8).
   * Refuses sensitive URLs before capture (Edge Case 8.4).
   * Requires non-empty question (Edge Case 8.10).
   */
  async function handleAskAboutScreen() {
    setNotice(null);
    if (loading) return;

    const question = input.trim();
    if (!question) {
      setNotice(
        "Type your question below first, then click Ask about screen.",
      );
      setTimeout(() => setNotice(null), 4000);
      return;
    }

    const settings = await getSettings().catch(() => null);
    const extraAllowlist = settings?.extraAllowlist ?? [];
    const urlClass = tabUrl ? classifyUrl(tabUrl, extraAllowlist) : null;

    if (urlClass === "sensitive") {
      setMessagesForCurrentTab((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: `📷 [Screenshot Query] ${question}`,
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: ERROR_MESSAGES.sensitive_page,
          isError: true,
        },
      ]);
      return;
    }

    const res = await sendCommand<{ dataUrl: string }>(
      "capture/visible",
      undefined,
      activeTabId,
    );

    if (!res.ok) {
      setNotice(res.error.message);
      return;
    }

    setCapturedPngDataUrl(res.data.dataUrl);
  }

  /**
   * Confirms the cropped/full screenshot and streams the answer using Flash vision route.
   */
  async function handleCropConfirm(jpegDataUrl: string) {
    const question = input.trim();
    setCapturedPngDataUrl(null); // Drop full PNG data URL immediately (Edge Case 8.3 & 8.6)
    setInput("");

    const parsed = parseDataUrl(jpegDataUrl);
    if (!parsed) {
      setNotice("Could not process image format.");
      return;
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: `📷 [Screenshot] ${question}`,
    };

    const assistantMsgId = crypto.randomUUID();
    const initialAssistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessagesForCurrentTab((prev) => [...prev, userMsg, initialAssistantMsg]);
    setLoading(true);
    setWaitingStatus(null);

    const settings = await getSettings().catch(() => null);
    const language = settings?.language ?? "en";

    const prompt = buildPrompt({
      task: "screenshot",
      language,
      userText: question,
    });

    let accumulatedText = "";
    const streamResult = await generateContentStream(
      {
        prompt,
        task: "screenshot",
        model: GEMINI_MODELS.flash, // Flash vision route (no Groq fallback)
        inlineData: {
          mimeType: parsed.mimeType,
          data: parsed.base64,
        },
        onStatus: (status) => setWaitingStatus(status),
      },
      (token) => {
        accumulatedText += token;
        setMessagesForCurrentTab((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: accumulatedText } : m,
          ),
        );
      },
    );

    setLoading(false);

    if (streamResult.ok) {
      setMessagesForCurrentTab((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: streamResult.data, isStreaming: false }
            : m,
        ),
      );
    } else {
      setMessagesForCurrentTab((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: streamResult.error.message,
                isStreaming: false,
                isError: true,
              }
            : m,
        ),
      );
    }
  }

  async function sendQuery(query: string, displayLabel?: string) {
    if (!query || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: displayLabel || query,
    };

    const assistantMsgId = crypto.randomUUID();
    const initialAssistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    // Append user message and streaming assistant placeholder
    setMessagesForCurrentTab((prev) => [...prev, userMsg, initialAssistantMsg]);
    setInput("");
    setLoading(true);
    setWaitingStatus(null);

    // 1. Refresh page/extract on each send & enforce sensitive URL gates (Slice 6 step 2)
    const extractRes = await sendCommand<PageExtract>(
      "page/extract",
      undefined,
      activeTabId,
    );

    if (!extractRes.ok) {
      setLoading(false);
      setMessagesForCurrentTab((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: extractRes.error.message,
                isStreaming: false,
                isError: true,
              }
            : m,
        ),
      );
      return;
    }

    const pageData = extractRes.data;
    setCurrentExtract(pageData);

    // 2. Prepare context: YouTube canonical watch URL vs Article readable text
    const isYouTube = pageData.kind === "youtube" && Boolean(pageData.videoId);
    const mediaUrl = isYouTube
      ? pageData.canonicalUrl ||
        `https://www.youtube.com/watch?v=${pageData.videoId}`
      : undefined;
    const pageText = isYouTube ? "" : pageData.text;

    // 3. Assemble prompt with history (capped at last 8 turns) & grounding instructions
    const historyTurns: ChatTurn[] = messages
      .filter((m) => !m.isError && m.id !== "init" && m.content)
      .slice(-LIMITS.chatHistoryTurns)
      .map((m) => ({ role: m.role, content: m.content }));

    const settings = await getSettings().catch(() => null);
    const profile = await getProfile().catch(() => null);
    const language = settings?.language ?? "en";
    const extraAllowlist = settings?.extraAllowlist ?? [];
    const isSensitive = tabUrl ? classifyUrl(tabUrl, extraAllowlist) === "sensitive" : false;

    const prompt = buildPrompt({
      task: "chat",
      language,
      page: pageText,
      profile: isSensitive ? null : profile,
      isSensitive,
      history: historyTurns,
      userText: query,
    });

    // 4. Stream tokens into the assistant bubble (Slice 6 step 6)
    let accumulatedText = "";

    const streamResult = await generateContentStream(
      {
        prompt,
        task: "chat",
        ...(isYouTube
          ? { model: GEMINI_MODELS.flash, mediaUrl }
          : { model: GEMINI_MODELS.flashLite }),
        onStatus: (status) => setWaitingStatus(status),
      },
      (token) => {
        accumulatedText += token;
        setMessagesForCurrentTab((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: accumulatedText,
                }
              : m,
          ),
        );
      },
    );

    setLoading(false);

    if (streamResult.ok) {
      const finalText = streamResult.data;
      const lower = finalText.toLowerCase();
      const isOffPage =
        lower.includes("not on this page") ||
        lower.includes("not mentioned in this video") ||
        lower.includes("not found on this page");

      setMessagesForCurrentTab((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: finalText,
                isStreaming: false,
                isOffPage,
              }
            : m,
        ),
      );
    } else {
      // Leave user message in place; show error code's sentence in assistant bubble
      setMessagesForCurrentTab((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: streamResult.error.message,
                isStreaming: false,
                isError: true,
              }
            : m,
        ),
      );
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const query = input.trim();
    if (!query) return;
    await sendQuery(query);
  }

  async function handleSelectSkill(skill: Skill) {
    if (loading) return;
    await sendQuery(skill.prompt, `⚡ ${skill.name}`);
  }

  function handleClear() {
    setMessagesForCurrentTab(() => [DEFAULT_WELCOME_MESSAGE]);
  }

  const isYouTube = currentExtract?.kind === "youtube";
  const displayTitle = currentExtract?.title || tabTitle || "Current Page";

  return (
    <div className="chat-view" data-testid="chat-view">
      <div className="chat-header-bar">
        <span className="chat-grounding-tag" title={displayTitle}>
          {isYouTube ? "🎬 YouTube: " : "📄 Grounded: "}
          {displayTitle}
        </span>
        <div className="chat-header-actions">
          {!isSensitive ? (
            <button
              type="button"
              className="chat-header-btn"
              onClick={handleAskAboutScreen}
              disabled={loading}
              title="Ask a question about a screenshot of this tab"
            >
              📷 Ask screen
            </button>
          ) : null}
          <button
            type="button"
            className="chat-header-btn"
            onClick={handleExplainSelection}
            disabled={loading}
            title="Explain selected text on this page"
          >
            Explain selection
          </button>
          <button
            type="button"
            className="chat-clear-btn"
            onClick={handleClear}
            title="Clear transcript for this tab"
          >
            Clear
          </button>
        </div>
      </div>

      {notice ? (
        <div className="selection-notice" role="status">
          {notice}
        </div>
      ) : null}

      {capturedPngDataUrl ? (
        <Cropper
          dataUrl={capturedPngDataUrl}
          onConfirm={handleCropConfirm}
          onCancel={() => setCapturedPngDataUrl(null)}
        />
      ) : null}

      <div className="chat-messages" role="log" aria-live="polite">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-bubble ${m.role} ${m.isError ? "error" : ""} ${m.isOffPage ? "off-page" : ""}`}
          >
            <div className="bubble-header-row">
              <span className="bubble-role">
                {m.role === "user" ? "You" : "Sahayak"}
              </span>
              {m.isOffPage ? (
                <span className="off-page-pill">{ERROR_MESSAGES.off_page}</span>
              ) : null}
            </div>

            <div className="bubble-content">
              {m.content}
              {m.isStreaming && !m.content ? (
                <span className="typing-dots">{waitingStatus || "Thinking…"}</span>
              ) : null}
              {m.isStreaming && m.content ? (
                <span className="stream-cursor">▌</span>
              ) : null}
            </div>

            {m.isError && m.content.includes("Settings") && onOpenSettings ? (
              <div style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="chat-settings-btn"
                  onClick={onOpenSettings}
                >
                  Open Settings
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <SkillsRow onSelectSkill={handleSelectSkill} />

      <form className="chat-composer" onSubmit={handleSend}>
        <input
          type="text"
          className="chat-input"
          placeholder={
            isYouTube
              ? "Ask a question about this video…"
              : "Ask a question about this page…"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          autoFocus
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={loading || !input.trim()}
        >
          {loading ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
