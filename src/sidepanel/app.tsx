import { useCallback, useEffect, useState } from "react";
import {
  ERROR_MESSAGES,
  type Envelope,
  type Language,
  type PanelReadyData,
  type PendingIntent,
  type Settings,
} from "../shared/protocol";
import { classifyUrl } from "../shared/safety-policy";
import { clearPendingIntent, getSettings, setSettings } from "../shared/storage";
import { isYouTubeWatch } from "../shared/youtube";
import { ActView } from "./components/act";
import { AskBox } from "./components/ask-box";
import { ChatView } from "./components/chat";
import { SettingsForm } from "./components/settings";
import { SummaryView } from "./components/summary";
import { sendCommand } from "./lib/messaging";

type View = "summary" | "chat" | "act" | "ask" | "settings";

export function App() {
  const [view, setView] = useState<View>("summary");
  const [tabId, setTabId] = useState<number | undefined>(undefined);
  const [tabTitle, setTabTitle] = useState("Loading tab…");
  const [tabUrl, setTabUrl] = useState("");
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);

  const refresh = useCallback(async () => {
    setBootError(null);

    const ready = await sendCommand<PanelReadyData>("panel/ready");
    if (!ready.ok) {
      setBootError(ready.error.message);
    } else if (ready.data?.pendingIntent) {
      setPendingIntent(ready.data.pendingIntent);
      setView("chat");
      void clearPendingIntent();
    }

    const active = await sendCommand<{
      tabId: number;
      url: string;
      title: string;
    }>("tab/getActive");

    if (active.ok) {
      setTabId(active.data.tabId);
      setTabTitle(active.data.title || "(untitled tab)");
      setTabUrl(active.data.url);
    } else {
      setTabId(undefined);
      setTabTitle("No active tab");
      setTabUrl("");
      setBootError(active.error.message);
    }

    try {
      setSettingsState(await getSettings());
    } catch {
      setBootError("Could not read settings.");
    }
  }, []);

  useEffect(() => {
    void refresh();

    const onActivated = () => {
      void refresh();
    };

    const onUpdated = (
      _changedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (changeInfo.status === "complete" || changeInfo.url || changeInfo.title) {
        void refresh();
      }
    };

    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.onActivated?.addListener(onActivated);
      chrome.tabs.onUpdated?.addListener(onUpdated);
    }

    // Also listen for immediate runtime message if panel is already open (Slice 7)
    const onMessage = (message: Envelope<PendingIntent>) => {
      if (message && message.cmd === "intent/pending" && message.payload) {
        setPendingIntent(message.payload);
        setView("chat");
        void clearPendingIntent();
      }
    };

    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(onMessage);
    }

    return () => {
      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.onActivated?.removeListener(onActivated);
        chrome.tabs.onUpdated?.removeListener(onUpdated);
      }
      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(onMessage);
      }
    };
  }, [refresh]);

  const handleLanguageToggle = async (lang: Language) => {
    try {
      const updated = await setSettings({ language: lang });
      setSettingsState(updated);
    } catch {
      // fallback
    }
  };

  const hasKey = Boolean(settings?.geminiApiKey.trim());
  const urlClass = tabUrl
    ? classifyUrl(tabUrl, settings?.extraAllowlist ?? [])
    : null;
  const isYtTab = isYouTubeWatch(tabUrl);

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <div className="brand">Sahayak</div>
          <div className="lang-toggle-wrap" role="group" aria-label="Output Language">
            <button
              type="button"
              className={`lang-btn ${settings?.language !== "hinglish" ? "active" : ""}`}
              onClick={() => void handleLanguageToggle("en")}
              title="English output"
            >
              EN
            </button>
            <button
              type="button"
              className={`lang-btn ${settings?.language === "hinglish" ? "active" : ""}`}
              onClick={() => void handleLanguageToggle("hinglish")}
              title="Hinglish output"
            >
              Hinglish
            </button>
          </div>
        </div>

        <div className="tab-title">
          {isYtTab ? <span className="yt-cue">🎬 YouTube</span> : null}
          {tabTitle}
        </div>

        {urlClass === "sensitive" ? (
          <span className="badge sensitive-badge">Sensitive page</span>
        ) : null}
      </header>

      <nav className="nav" aria-label="Sahayak views">
        <button
          type="button"
          className={view === "summary" ? "active" : undefined}
          onClick={() => setView("summary")}
        >
          Summary
        </button>
        <button
          type="button"
          className={view === "chat" ? "active" : undefined}
          onClick={() => setView("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className={view === "act" ? "active" : undefined}
          onClick={() => setView("act")}
        >
          Act
        </button>
        <button
          type="button"
          className={view === "ask" ? "active" : undefined}
          onClick={() => setView("ask")}
        >
          Ask
        </button>
        <button
          type="button"
          className={view === "settings" ? "active" : undefined}
          onClick={() => setView("settings")}
        >
          Settings
        </button>
      </nav>

      <main className="panel">
        {bootError ? <p className="empty">{bootError}</p> : null}

        {view === "settings" ? (
          <SettingsForm
            onSaved={(next) => {
              setSettingsState(next);
            }}
          />
        ) : !hasKey ? (
          <div className="empty" role="status">
            {ERROR_MESSAGES.missing_key}
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => setView("settings")}>
                Open Settings
              </button>
            </div>
          </div>
        ) : view === "summary" ? (
          <>
            <SummaryView onOpenSettings={() => setView("settings")} />
            {urlClass === "sensitive" ? (
              <p className="empty" style={{ marginTop: 12 }}>
                {ERROR_MESSAGES.sensitive_page}
              </p>
            ) : null}
          </>
        ) : view === "chat" ? (
          <>
            <ChatView
              tabId={tabId}
              tabTitle={tabTitle}
              tabUrl={tabUrl}
              urlClass={urlClass}
              incomingIntent={pendingIntent}
              onClearIntent={() => setPendingIntent(null)}
              onOpenSettings={() => setView("settings")}
            />
            {urlClass === "sensitive" ? (
              <p className="empty" style={{ marginTop: 12 }}>
                {ERROR_MESSAGES.sensitive_page}
              </p>
            ) : null}
          </>
        ) : view === "act" ? (
          <>
            <ActView
              tabUrl={tabUrl}
              urlClass={urlClass}
              onOpenSettings={() => setView("settings")}
            />
            {urlClass === "sensitive" ? (
              <p className="empty" style={{ marginTop: 12 }}>
                {ERROR_MESSAGES.sensitive_page}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <AskBox onOpenSettings={() => setView("settings")} />
            {urlClass === "sensitive" ? (
              <p className="empty" style={{ marginTop: 12 }}>
                {ERROR_MESSAGES.sensitive_page}
              </p>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
