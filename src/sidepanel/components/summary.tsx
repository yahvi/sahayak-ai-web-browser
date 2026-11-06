import { useCallback, useEffect, useState } from "react";
import { generateText } from "../../ai/client";
import { parseSummary } from "../../ai/parse";
import { buildPrompt } from "../../ai/prompts";
import {
  ERROR_MESSAGES,
  type ErrorCode,
  type PageExtract,
  type SummaryResult,
} from "../../shared/protocol";
import { getSettings } from "../../shared/storage";
import { timestampToSeconds } from "../../shared/youtube";
import { sendCommand } from "../lib/messaging";

interface SummaryViewProps {
  onOpenSettings?: () => void;
}

export function SummaryView({ onOpenSettings }: SummaryViewProps) {
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<
    "extracting" | "summarising" | null
  >(null);
  const [extract, setExtract] = useState<PageExtract | null>(null);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [waitingStatus, setWaitingStatus] = useState<string | null>(null);
  const [error, setError] = useState<{
    code: ErrorCode;
    message: string;
  } | null>(null);

  // Probe active tab on mount to identify page kind
  useEffect(() => {
    void (async () => {
      const res = await sendCommand<PageExtract>("page/extract");
      if (res.ok) {
        setExtract(res.data);
      }
    })();
  }, []);

  const runSummary = useCallback(async () => {
    setLoading(true);
    setLoadingPhase("extracting");
    setWaitingStatus(null);
    setError(null);
    setSummary(null);

    // 1. Extract content from active tab through background routing
    const extractResult = await sendCommand<PageExtract>("page/extract");
    if (!extractResult.ok) {
      setLoading(false);
      setLoadingPhase(null);
      setError(extractResult.error);
      return;
    }

    const pageData = extractResult.data;
    setExtract(pageData);

    const settings = await getSettings().catch(() => null);
    const language = settings?.language ?? "en";

    // 2. Handle YouTube video summary (Slice 4)
    if (pageData.kind === "youtube") {
      if (!pageData.videoId) {
        setLoading(false);
        setLoadingPhase(null);
        setError({
          code: "youtube_unsupported",
          message:
            "This is a YouTube playlist or navigation page. Open a public video to summarise it.",
        });
        return;
      }

      setLoadingPhase("summarising");
      const canonicalUrl =
        pageData.canonicalUrl ||
        `https://www.youtube.com/watch?v=${pageData.videoId}`;

      const prompt = buildPrompt({
        task: "youtube_summary",
        language,
        userText: `Summarise this public YouTube video with TL;DR, five key points, what to do next, and chapter timestamp notes: ${pageData.title}`,
      });

      const genResult = await generateText({
        prompt,
        task: "youtube_summary",
        mediaUrl: canonicalUrl,
        onStatus: (status) => setWaitingStatus(status),
      });

      setLoading(false);
      setLoadingPhase(null);

      if (!genResult.ok) {
        setError(genResult.error);
        return;
      }

      const parsed = parseSummary(genResult.data);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }

      setSummary(parsed.data);
      return;
    }

    // 3. Handle Article / Generic Web Page (Slice 3)
    if (!pageData.text.trim()) {
      setLoading(false);
      setLoadingPhase(null);
      setError({
        code: "off_page",
        message: ERROR_MESSAGES.off_page,
      });
      return;
    }

    setLoadingPhase("summarising");

    const prompt = buildPrompt({
      task: "summary",
      language,
      page: pageData.text,
      userText: `Summarise this ${pageData.kind === "article" ? "article" : "page"}: ${pageData.title}`,
    });

    const genResult = await generateText({
      prompt,
      task: "summary",
      onStatus: (status) => setWaitingStatus(status),
    });

    setLoading(false);
    setLoadingPhase(null);

    if (!genResult.ok) {
      setError(genResult.error);
      return;
    }

    const parsed = parseSummary(genResult.data);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setSummary(parsed.data);
  }, []);

  const handleSeek = useCallback(async (timestamp: string) => {
    const seconds = timestampToSeconds(timestamp);
    await sendCommand("page/seek", { seconds });
  }, []);

  const isYouTube = extract?.kind === "youtube";
  const isWatchableVideo = isYouTube && Boolean(extract.videoId);

  return (
    <div className="summary-view" data-testid="summary-view">
      <div className="summary-controls">
        <button
          type="button"
          className="summary-btn primary"
          onClick={() => void runSummary()}
          disabled={loading}
        >
          {loading
            ? loadingPhase === "extracting"
              ? "Checking page…"
              : isYouTube
                ? "Summarising video with Flash…"
                : "Summarising page…"
            : summary
              ? isYouTube
                ? "Re-summarise video"
                : "Re-summarise"
              : isYouTube
                ? "Summarise this video"
                : "Summarise this page"}
        </button>

        {extract ? (
          <span className={`kind-tag ${extract.kind}`}>
            {extract.kind === "article"
              ? "Article"
              : isWatchableVideo
                ? "YouTube Video"
                : extract.kind === "youtube"
                  ? "YouTube"
                  : "Generic Page"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="status" role="status">
          {waitingStatus ||
            (loadingPhase === "extracting"
              ? "Reading page and checking media…"
              : isYouTube
                ? "Gemini Flash is analyzing the video content…"
                : "Sahayak is reading and summarising…")}
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

      {!loading && !error && isYouTube && !isWatchableVideo ? (
        <div className="youtube-detected-box">
          <div className="box-title">YouTube Navigation Page</div>
          <p className="youtube-note">
            This is a YouTube playlist or channel page. Open any public video to
            summarise it with timestamps and chapters.
          </p>
        </div>
      ) : null}

      {summary ? (
        <div className="summary-results" aria-label="Structured summary">
          {extract?.title ? (
            <div className="summary-page-title">
              {isYouTube ? "🎬 " : ""}
              {extract.title}
            </div>
          ) : null}

          <section className="summary-card tldr-card">
            <div className="card-label">TL;DR</div>
            <div className="card-text">{summary.tldr}</div>
          </section>

          <section className="summary-card points-card">
            <div className="card-label">Key Points</div>
            <ol className="points-list">
              {summary.points.map((pt, idx) => (
                <li key={idx} className="point-item">
                  {pt}
                </li>
              ))}
            </ol>
          </section>

          {summary.chapters && summary.chapters.length > 0 ? (
            <section className="summary-card chapters-card">
              <div className="card-label">Chapters & Key Moments</div>
              <div className="chapters-list">
                {summary.chapters.map((ch, idx) => (
                  <div key={idx} className="chapter-row">
                    <button
                      type="button"
                      className="chapter-timestamp-btn"
                      onClick={() => void handleSeek(ch.timestamp)}
                      title={`Jump to ${ch.timestamp}`}
                    >
                      ▶ {ch.timestamp}
                    </button>
                    <span className="chapter-note">{ch.note}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {summary.next ? (
            <section className="summary-card next-card">
              <div className="card-label">What to do next</div>
              <div className="card-text">{summary.next}</div>
            </section>
          ) : null}
        </div>
      ) : null}

      {!loading && !summary && !error && (!isYouTube || isWatchableVideo) ? (
        <p className="muted" style={{ marginTop: 8 }}>
          {isYouTube
            ? "Click above to summarise this video with a 1-line TL;DR, 5 key points, next step, and clickable chapter timestamps."
            : "Click above to generate a 1-line TL;DR, 5 key points, and a next step from this tab."}
        </p>
      ) : null}
    </div>
  );
}
