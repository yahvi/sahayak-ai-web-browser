import { LIMITS } from "../shared/limits";
import {
  GEMINI_MODELS,
  getTaskRoute,
  GROQ_MODELS,
  type TaskKind,
} from "../shared/models";
import { err, ok, type Result } from "../shared/protocol";
import { getSettings } from "../shared/storage";

export interface GenerateTextOptions {
  prompt: string;
  task?: TaskKind;
  model?: string;
  apiKey?: string;
  groqApiKey?: string;
  mediaUrl?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  isSensitive?: boolean;
  onStatus?: (status: string) => void;
  retryDelayMs?: number;
}

export interface GenerateJsonOptions<T> extends GenerateTextOptions {
  parse: (raw: string) => Result<T>;
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Parses HTTP Retry-After header (seconds or HTTP-date) and caps at LIMITS.retryAfterCapSeconds.
 */
export function parseRetryAfter(
  header: string | null,
  capSeconds: number = LIMITS.retryAfterCapSeconds,
): number {
  if (!header) return 1;
  const num = parseInt(header, 10);
  if (!isNaN(num) && num >= 0) {
    return Math.min(num, capSeconds);
  }
  const dateMs = Date.parse(header);
  if (!isNaN(dateMs)) {
    const diffSec = Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
    return Math.min(diffSec, capSeconds);
  }
  return 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Text-only Groq fallback call (architecture §9.1 & §9.3).
 * Never throws across boundaries.
 */
async function callGroqText(
  prompt: string,
  groqApiKey: string,
  timeoutMs: number,
): Promise<Result<string>> {
  const controller = new AbortController();
  let isTimedOut = false;
  const timeoutId = setTimeout(() => {
    isTimedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODELS.default,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      return err("rate_limited");
    }

    if (!res.ok) {
      return err("model_unavailable");
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return err("invalid_model_output");
    }

    return ok(text);
  } catch (e) {
    if (isTimedOut || (e instanceof Error && e.name === "AbortError")) {
      return err("timeout");
    }
    return err("model_unavailable");
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Text-only Groq streaming fallback call (architecture §9.1 & §9.3).
 */
async function callGroqStream(
  prompt: string,
  groqApiKey: string,
  timeoutMs: number,
  onChunk: (chunk: string) => void,
): Promise<Result<string>> {
  const controller = new AbortController();
  let isTimedOut = false;
  const timeoutId = setTimeout(() => {
    isTimedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODELS.default,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      return err("rate_limited");
    }

    if (!res.ok) {
      return err("model_unavailable");
    }

    const reader = res.body?.getReader();
    if (!reader) {
      return err("generic", "No response stream available.");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";

    interface GroqChunk {
      choices?: Array<{
        delta?: { content?: string };
        finish_reason?: string | null;
      }>;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(jsonStr) as GroqChunk;
          const textChunk = parsed.choices?.[0]?.delta?.content ?? "";
          if (textChunk) {
            accumulatedText += textChunk;
            onChunk(textChunk);
          }
        } catch {
          // ignore incomplete chunk
        }
      }
    }

    if (!accumulatedText.trim()) {
      return err("invalid_model_output");
    }

    return ok(accumulatedText);
  } catch (e) {
    if (isTimedOut || (e instanceof Error && e.name === "AbortError")) {
      return err("timeout");
    }
    return err("model_unavailable");
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Non-streaming text and media generation with Gemini (architecture §9.2),
 * with 429 Retry-After, 5xx retry, and Groq text fallback (Slice 9).
 */
export async function generateText(
  input: string | GenerateTextOptions,
): Promise<Result<string>> {
  try {
    const options: GenerateTextOptions =
      typeof input === "string" ? { prompt: input } : input;

    const task: TaskKind = options.task ?? "free_ask";
    const route = getTaskRoute(task);
    const model = options.model ?? route.primary;

    const settings = await getSettings().catch(() => null);

    let apiKey = options.apiKey?.trim();
    if (!apiKey && settings) {
      apiKey = settings.geminiApiKey?.trim();
    }
    if (!apiKey && typeof __ENV_GEMINI_KEY__ !== "undefined") {
      apiKey = __ENV_GEMINI_KEY__.trim();
    }

    let groqApiKey = options.groqApiKey?.trim();
    if (!groqApiKey && settings) {
      groqApiKey = settings.groqApiKey?.trim();
    }
    if (!groqApiKey && typeof __ENV_GROQ_KEY__ !== "undefined") {
      groqApiKey = __ENV_GROQ_KEY__.trim();
    }

    const canFallbackToGroq =
      route.allowGroqFallback &&
      !options.mediaUrl &&
      !options.inlineData &&
      !options.isSensitive &&
      Boolean(groqApiKey);

    if (!apiKey) {
      return err("missing_key");
    }

    const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const parts: Array<Record<string, unknown>> = [
      {
        text: options.prompt,
      },
    ];

    if (options.mediaUrl) {
      parts.push({
        file_data: {
          file_uri: options.mediaUrl,
        },
      });
    }

    if (options.inlineData) {
      parts.push({
        inline_data: {
          mime_type: options.inlineData.mimeType,
          data: options.inlineData.data,
        },
      });
    }

    const requestBody = {
      contents: [
        {
          parts,
        },
      ],
    };

    let response: Response | null = null;
    let didRetry = false;

    while (true) {
      const controller = new AbortController();
      let isTimedOut = false;
      const timeoutId = setTimeout(() => {
        isTimedOut = true;
        controller.abort();
      }, LIMITS.modelTimeoutMs);

      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } catch (e) {
        clearTimeout(timeoutId);
        if (isTimedOut || (e instanceof Error && e.name === "AbortError")) {
          return err("timeout");
        }

        // Network error retry once (Slice 9 step 2)
        if (!didRetry) {
          didRetry = true;
          options.onStatus?.("Sahayak is waiting for the free model.");
          await sleep(options.retryDelayMs ?? 1000);
          continue;
        }

        if (canFallbackToGroq && groqApiKey) {
          return callGroqText(options.prompt, groqApiKey, LIMITS.modelTimeoutMs);
        }

        if (task === "youtube_summary") {
          return err("youtube_unsupported");
        }
        return err("model_unavailable");
      }

      clearTimeout(timeoutId);

      // HTTP 429 Rate Limit (Slice 9 step 1)
      if (response.status === 429) {
        if (!didRetry) {
          didRetry = true;
          const retryHeader = response.headers?.get?.("retry-after") ?? null;
          const retrySeconds = parseRetryAfter(retryHeader);
          options.onStatus?.("Sahayak is waiting for the free model.");
          await sleep(options.retryDelayMs ?? retrySeconds * 1000);
          continue;
        }

        if (canFallbackToGroq && groqApiKey) {
          return callGroqText(options.prompt, groqApiKey, LIMITS.modelTimeoutMs);
        }

        return err("rate_limited");
      }

      // HTTP 5xx Server Error (Slice 9 step 2)
      if (response.status >= 500) {
        if (!didRetry) {
          didRetry = true;
          options.onStatus?.("Sahayak is waiting for the free model.");
          await sleep(options.retryDelayMs ?? 1000);
          continue;
        }

        if (canFallbackToGroq && groqApiKey) {
          return callGroqText(options.prompt, groqApiKey, LIMITS.modelTimeoutMs);
        }

        return err("model_unavailable");
      }

      if (!response.ok) {
        try {
          const errorData = await response.json();
          console.warn("[Sahayak Gemini Error]", response.status, errorData);
        } catch {
          // ignore
        }

        if (task === "youtube_summary") {
          return err("youtube_unsupported");
        }
        return err("model_unavailable");
      }

      break;
    }

    if (!response) {
      return err("model_unavailable");
    }

    interface GeminiCandidate {
      content?: {
        parts?: Array<{ text?: string }>;
        role?: string;
      };
      finishReason?: string;
    }

    interface GeminiResponse {
      candidates?: GeminiCandidate[];
      error?: { code: number; message: string; status: string };
    }

    const json = (await response.json()) as GeminiResponse;
    const candidate = json.candidates?.[0];
    if (!candidate) {
      return err("invalid_model_output");
    }

    const text =
      candidate.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

    if (!text) {
      return err("invalid_model_output");
    }

    return ok(text);
  } catch {
    return err("generic");
  }
}

/**
 * Streaming token generation with Gemini using SSE streamGenerateContent (architecture §9.2),
 * with 429 Retry-After, 5xx retry, and Groq streaming text fallback (Slice 9).
 */
export async function generateContentStream(
  input: string | GenerateTextOptions,
  onChunk: (chunk: string) => void,
): Promise<Result<string>> {
  try {
    const options: GenerateTextOptions =
      typeof input === "string" ? { prompt: input } : input;

    const task: TaskKind = options.task ?? "chat";
    const route = getTaskRoute(task);
    const model = options.model ?? route.primary;

    const settings = await getSettings().catch(() => null);

    let apiKey = options.apiKey?.trim();
    if (!apiKey && settings) {
      apiKey = settings.geminiApiKey?.trim();
    }
    if (!apiKey && typeof __ENV_GEMINI_KEY__ !== "undefined") {
      apiKey = __ENV_GEMINI_KEY__.trim();
    }

    let groqApiKey = options.groqApiKey?.trim();
    if (!groqApiKey && settings) {
      groqApiKey = settings.groqApiKey?.trim();
    }
    if (!groqApiKey && typeof __ENV_GROQ_KEY__ !== "undefined") {
      groqApiKey = __ENV_GROQ_KEY__.trim();
    }

    const canFallbackToGroq =
      route.allowGroqFallback &&
      !options.mediaUrl &&
      !options.inlineData &&
      !options.isSensitive &&
      Boolean(groqApiKey);

    if (!apiKey) {
      return err("missing_key");
    }

    const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    const parts: Array<Record<string, unknown>> = [
      {
        text: options.prompt,
      },
    ];

    if (options.mediaUrl) {
      parts.push({
        file_data: {
          file_uri: options.mediaUrl,
        },
      });
    }

    if (options.inlineData) {
      parts.push({
        inline_data: {
          mime_type: options.inlineData.mimeType,
          data: options.inlineData.data,
        },
      });
    }

    const requestBody = {
      contents: [
        {
          parts,
        },
      ],
    };

    let response: Response | null = null;
    let didRetry = false;

    while (true) {
      const controller = new AbortController();
      let isTimedOut = false;
      const timeoutId = setTimeout(() => {
        isTimedOut = true;
        controller.abort();
      }, LIMITS.modelTimeoutMs);

      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } catch (e) {
        clearTimeout(timeoutId);
        if (isTimedOut || (e instanceof Error && e.name === "AbortError")) {
          return err("timeout");
        }

        // Network error retry once
        if (!didRetry) {
          didRetry = true;
          options.onStatus?.("Sahayak is waiting for the free model.");
          await sleep(options.retryDelayMs ?? 1000);
          continue;
        }

        if (canFallbackToGroq && groqApiKey) {
          return callGroqStream(
            options.prompt,
            groqApiKey,
            LIMITS.modelTimeoutMs,
            onChunk,
          );
        }

        if (task === "youtube_summary") {
          return err("youtube_unsupported");
        }
        return err("model_unavailable");
      }

      clearTimeout(timeoutId);

      // HTTP 429 Rate Limit (Slice 9 step 1)
      if (response.status === 429) {
        if (!didRetry) {
          didRetry = true;
          const retryHeader = response.headers?.get?.("retry-after") ?? null;
          const retrySeconds = parseRetryAfter(retryHeader);
          options.onStatus?.("Sahayak is waiting for the free model.");
          await sleep(options.retryDelayMs ?? retrySeconds * 1000);
          continue;
        }

        if (canFallbackToGroq && groqApiKey) {
          return callGroqStream(
            options.prompt,
            groqApiKey,
            LIMITS.modelTimeoutMs,
            onChunk,
          );
        }

        return err("rate_limited");
      }

      // HTTP 5xx Server Error (Slice 9 step 2)
      if (response.status >= 500) {
        if (!didRetry) {
          didRetry = true;
          options.onStatus?.("Sahayak is waiting for the free model.");
          await sleep(options.retryDelayMs ?? 1000);
          continue;
        }

        if (canFallbackToGroq && groqApiKey) {
          return callGroqStream(
            options.prompt,
            groqApiKey,
            LIMITS.modelTimeoutMs,
            onChunk,
          );
        }

        return err("model_unavailable");
      }

      if (!response.ok) {
        try {
          const errorData = await response.json();
          console.warn("[Sahayak Gemini Streaming Error]", response.status, errorData);
        } catch {
          // ignore
        }
        if (task === "youtube_summary") {
          return err("youtube_unsupported");
        }
        return err("model_unavailable");
      }

      break;
    }

    if (!response) {
      return err("model_unavailable");
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return err("generic", "No response stream available.");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";

    interface GeminiStreamCandidate {
      content?: {
        parts?: Array<{ text?: string }>;
        role?: string;
      };
      finishReason?: string;
    }

    interface GeminiStreamResponse {
      candidates?: GeminiStreamCandidate[];
      error?: { code: number; message: string; status: string };
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(jsonStr) as GeminiStreamResponse;
          const textChunk =
            parsed.candidates?.[0]?.content?.parts
              ?.map((p) => p.text ?? "")
              .join("") ?? "";

          if (textChunk) {
            accumulatedText += textChunk;
            onChunk(textChunk);
          }
        } catch {
          // ignore incomplete SSE chunk
        }
      }
    }

    if (buffer.trim().startsWith("data:")) {
      try {
        const parsed = JSON.parse(buffer.trim().slice(5).trim()) as GeminiStreamResponse;
        const textChunk =
          parsed.candidates?.[0]?.content?.parts
            ?.map((p) => p.text ?? "")
            .join("") ?? "";
        if (textChunk) {
          accumulatedText += textChunk;
          onChunk(textChunk);
        }
      } catch {
        // ignore
      }
    }

    if (!accumulatedText.trim()) {
      return err("invalid_model_output");
    }

    return ok(accumulatedText);
  } catch {
    return err("generic");
  }
}

/**
 * Structured JSON generator with recovery hook (architecture §9.4 & Slice 9 step 6).
 * On parser error: re-asks once with parser error, then escalates to Flash once,
 * then returns invalid_model_output.
 */
export async function generateJson<T>(
  options: GenerateJsonOptions<T>,
): Promise<Result<T>> {
  // 1. Initial attempt
  const firstRes = await generateText(options);
  if (!firstRes.ok) {
    return firstRes;
  }

  const firstParsed = options.parse(firstRes.data);
  if (firstParsed.ok) {
    return firstParsed;
  }

  // 2. Re-ask once with parser error
  const repairPrompt = `${options.prompt}\n\nYour previous response was invalid: ${firstParsed.error.message}. Please respond with valid JSON adhering strictly to the schema.`;
  const secondRes = await generateText({
    ...options,
    prompt: repairPrompt,
  });

  if (secondRes.ok) {
    const secondParsed = options.parse(secondRes.data);
    if (secondParsed.ok) {
      return secondParsed;
    }
  }

  // 3. Escalate to Flash once
  const thirdRes = await generateText({
    ...options,
    prompt: repairPrompt,
    model: GEMINI_MODELS.flash,
  });

  if (thirdRes.ok) {
    const thirdParsed = options.parse(thirdRes.data);
    if (thirdParsed.ok) {
      return thirdParsed;
    }
  }

  return err("invalid_model_output");
}
