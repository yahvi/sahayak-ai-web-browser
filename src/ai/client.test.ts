import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GROQ_MODELS } from "../shared/models";
import { ERROR_MESSAGES, ok, err } from "../shared/protocol";
import {
  generateContentStream,
  generateJson,
  generateText,
  parseRetryAfter,
} from "./client";

describe("parseRetryAfter", () => {
  it("parses numeric string in seconds", () => {
    expect(parseRetryAfter("5")).toBe(5);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("caps retry after at capSeconds (default 8s)", () => {
    expect(parseRetryAfter("60")).toBe(8);
    expect(parseRetryAfter("10", 5)).toBe(5);
  });

  it("defaults to 1 for null, undefined, or invalid input", () => {
    expect(parseRetryAfter(null)).toBe(1);
    expect(parseRetryAfter("")).toBe(1);
    expect(parseRetryAfter("invalid-header")).toBe(1);
  });

  it("parses HTTP date string and returns capped delta seconds", () => {
    const futureDate = new Date(Date.now() + 4000).toUTCString();
    const result = parseRetryAfter(futureDate);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(8);
  });
});

describe("generateText", () => {
  const fakeStorage: Record<string, unknown> = {};

  beforeEach(() => {
    vi.stubGlobal("__ENV_GEMINI_KEY__", "");
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => {
            return { [key]: fakeStorage[key] };
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(fakeStorage, items);
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(fakeStorage)) {
      delete fakeStorage[key];
    }
  });

  it("returns missing_key and makes no network request when no key is saved", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText("Hello Gemini");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("missing_key");
      expect(result.error.message).toBe(ERROR_MESSAGES.missing_key);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls Gemini with Flash-Lite by default and returns generated text", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hello from Gemini Flash-Lite!" }],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText("Test prompt");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("Hello from Gemini Flash-Lite!");
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = fetchSpy.mock.calls[0];
    expect(callUrl).toContain("gemini-3.5-flash-lite");
    expect(callUrl).toContain("key=AIzaTestKey123");
    expect(JSON.parse(callOptions.body)).toEqual({
      contents: [{ parts: [{ text: "Test prompt" }] }],
    });
  });

  it("sends file_data with canonical URL on Flash route for youtube_summary", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: '{"tldr":"Summary","points":["P1"],"next":"N1"}' }],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Summarise this video",
      task: "youtube_summary",
      mediaUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = fetchSpy.mock.calls[0];
    expect(callUrl).toContain("gemini-3.5-flash");
    const parsedBody = JSON.parse(callOptions.body);
    expect(parsedBody.contents[0].parts).toEqual([
      { text: "Summarise this video" },
      { file_data: { file_uri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } },
    ]);
  });

  it("maps video rejection to youtube_unsupported error", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Video unsupported or private" } }),
      }),
    );

    const result = await generateText({
      prompt: "Summarise this video",
      task: "youtube_summary",
      mediaUrl: "https://www.youtube.com/watch?v=private123",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("youtube_unsupported");
      expect(result.error.message).toBe(ERROR_MESSAGES.youtube_unsupported);
    }
  });

  it("retries on HTTP 429 once, notifies onStatus, and succeeds with primary model without calling Groq", async () => {
    fakeStorage.settings = {
      geminiApiKey: "AIzaTestKey123",
      groqApiKey: "gsk_test_groq_key",
    };

    const statusUpdates: string[] = [];
    const mockGeminiResponse = {
      candidates: [
        {
          content: { parts: [{ text: "Recovered after 429 retry!" }] },
          finishReason: "STOP",
        },
      ],
    };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "retry-after" ? "2" : null,
        },
        json: async () => ({ error: { message: "Quota exceeded" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockGeminiResponse,
      });

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Retry test prompt",
      task: "free_ask",
      retryDelayMs: 0,
      onStatus: (s) => statusUpdates.push(s),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("Recovered after 429 retry!");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
    expect(fetchSpy.mock.calls[1][0]).toContain("generativelanguage.googleapis.com");
    expect(statusUpdates).toContain("Sahayak is waiting for the free model.");
  });

  it("falls back to Groq for a text task when Gemini returns 429 twice", async () => {
    fakeStorage.settings = {
      geminiApiKey: "AIzaTestKey123",
      groqApiKey: "gsk_test_groq_key",
    };

    const statusUpdates: string[] = [];
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => "1" },
        json: async () => ({ error: { message: "Quota exceeded" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => "1" },
        json: async () => ({ error: { message: "Quota exceeded" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Response from Groq LLaMA 3.3!" } }],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Text task prompt",
      task: "free_ask",
      retryDelayMs: 0,
      onStatus: (s) => statusUpdates.push(s),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("Response from Groq LLaMA 3.3!");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
    expect(fetchSpy.mock.calls[1][0]).toContain("generativelanguage.googleapis.com");
    expect(fetchSpy.mock.calls[2][0]).toContain("api.groq.com");
    const groqPayload = JSON.parse(fetchSpy.mock.calls[2][1].body);
    expect(groqPayload.model).toBe(GROQ_MODELS.default);
    expect(fetchSpy.mock.calls[2][1].headers.Authorization).toBe("Bearer gsk_test_groq_key");
    expect(statusUpdates).toContain("Sahayak is waiting for the free model.");
  });

  it("does NOT fall back to Groq for an image task when Gemini returns 429 twice", async () => {
    fakeStorage.settings = {
      geminiApiKey: "AIzaTestKey123",
      groqApiKey: "gsk_test_groq_key",
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "1" },
      json: async () => ({ error: { message: "Quota exceeded" } }),
    });

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Explain chart",
      task: "screenshot",
      inlineData: {
        mimeType: "image/jpeg",
        data: "base64image==",
      },
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      expect(call[0]).toContain("generativelanguage.googleapis.com");
      expect(call[0]).not.toContain("api.groq.com");
    }
  });

  it("does NOT fall back to Groq for a YouTube task when Gemini returns 429 twice", async () => {
    fakeStorage.settings = {
      geminiApiKey: "AIzaTestKey123",
      groqApiKey: "gsk_test_groq_key",
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "1" },
      json: async () => ({ error: { message: "Quota exceeded" } }),
    });

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Summarise video",
      task: "youtube_summary",
      mediaUrl: "https://www.youtube.com/watch?v=123",
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      expect(call[0]).toContain("generativelanguage.googleapis.com");
      expect(call[0]).not.toContain("api.groq.com");
    }
  });

  it("does NOT fall back to Groq when isSensitive is true", async () => {
    fakeStorage.settings = {
      geminiApiKey: "AIzaTestKey123",
      groqApiKey: "gsk_test_groq_key",
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "1" },
      json: async () => ({ error: { message: "Quota exceeded" } }),
    });

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Sensitive task",
      task: "free_ask",
      isSensitive: true,
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      expect(call[0]).toContain("generativelanguage.googleapis.com");
      expect(call[0]).not.toContain("api.groq.com");
    }
  });

  it("returns rate_limited on 429 twice when no Groq key is stored", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "1" },
      json: async () => ({ error: { message: "Quota exceeded" } }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Test prompt",
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.message).toBe(ERROR_MESSAGES.rate_limited);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx once, notifies onStatus, and succeeds with primary model", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const statusUpdates: string[] = [];
    const mockGeminiResponse = {
      candidates: [
        {
          content: { parts: [{ text: "Recovered from 503!" }] },
          finishReason: "STOP",
        },
      ],
    };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: "Service Unavailable" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockGeminiResponse,
      });

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Server error retry prompt",
      task: "free_ask",
      retryDelayMs: 0,
      onStatus: (s) => statusUpdates.push(s),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("Recovered from 503!");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(statusUpdates).toContain("Sahayak is waiting for the free model.");
  });

  it("falls back to Groq for a text task when Gemini returns 500 twice", async () => {
    fakeStorage.settings = {
      geminiApiKey: "AIzaTestKey123",
      groqApiKey: "gsk_test_groq_key",
    };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "Internal Error" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "Internal Error" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Fallback after 500 from Groq" } }],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Text prompt 500 fallback",
      task: "free_ask",
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("Fallback after 500 from Groq");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[2][0]).toContain("api.groq.com");
  });

  it("retries on network failure once, then falls back to Groq for text task", async () => {
    fakeStorage.settings = {
      geminiApiKey: "AIzaTestKey123",
      groqApiKey: "gsk_test_groq_key",
    };

    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch (1)"))
      .mockRejectedValueOnce(new Error("Failed to fetch (2)"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Fallback after network error from Groq" } }],
        }),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Network failure prompt",
      task: "free_ask",
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("Fallback after network error from Groq");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("maps HTTP 400/500 errors to model_unavailable error sentence, not raw body", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaBadKey" };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "API_KEY_INVALID" } }),
      }),
    );

    const result = await generateText({
      prompt: "Test prompt",
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("model_unavailable");
      expect(result.error.message).toBe(ERROR_MESSAGES.model_unavailable);
      expect(result.error.message).not.toContain("API_KEY_INVALID");
    }
  });

  it("maps network errors to model_unavailable when no Groq key is saved", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Failed to fetch")),
    );

    const result = await generateText({
      prompt: "Test prompt",
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("model_unavailable");
      expect(result.error.message).toBe(ERROR_MESSAGES.model_unavailable);
    }
  });

  it("maps timeout to timeout error", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await generateText("Test prompt");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("timeout");
      expect(result.error.message).toBe(ERROR_MESSAGES.timeout);
    }
  });

  it("maps empty candidates or empty text to invalid_model_output", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [] }),
      }),
    );

    const result = await generateText("Test prompt");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_model_output");
      expect(result.error.message).toBe(ERROR_MESSAGES.invalid_model_output);
    }
  });

  it("supports inlineData for screenshot vision task on Flash route with generateText", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: "The chart shows revenue up 20%." }],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateText({
      prompt: "Explain this chart",
      task: "screenshot",
      inlineData: {
        mimeType: "image/jpeg",
        data: "mockbase64jpegdata==",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("The chart shows revenue up 20%.");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = fetchSpy.mock.calls[0];
    expect(callUrl).toContain("gemini-3.5-flash");
    const parsedBody = JSON.parse(callOptions.body);
    expect(parsedBody.contents[0].parts).toEqual([
      { text: "Explain this chart" },
      {
        inline_data: {
          mime_type: "image/jpeg",
          data: "mockbase64jpegdata==",
        },
      },
    ]);
  });
});

describe("generateContentStream", () => {
  const fakeStorage: Record<string, unknown> = {};

  beforeEach(() => {
    vi.stubGlobal("__ENV_GEMINI_KEY__", "");
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => {
            return { [key]: fakeStorage[key] };
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(fakeStorage, items);
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(fakeStorage)) {
      delete fakeStorage[key];
    }
  });

  function createMockSseResponse(dataEvents: unknown[]) {
    const encoder = new TextEncoder();
    const sseText =
      dataEvents.map((evt) => `data: ${JSON.stringify(evt)}\n\n`).join("") +
      "data: [DONE]\n\n";

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseText));
        controller.close();
      },
    });

    return {
      ok: true,
      status: 200,
      body: stream,
    };
  }

  it("returns missing_key when no key is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const chunks: string[] = [];
    const result = await generateContentStream("Stream test", (chunk) => {
      chunks.push(chunk);
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("missing_key");
      expect(result.error.message).toBe(ERROR_MESSAGES.missing_key);
    }
    expect(chunks).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("streams tokens via onChunk and resolves with accumulated text", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const sseData = [
      {
        candidates: [{ content: { parts: [{ text: "Hello " }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: "world! " }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: "This is grounded." }] } }],
      },
    ];

    const fetchSpy = vi.fn().mockResolvedValue(createMockSseResponse(sseData));
    vi.stubGlobal("fetch", fetchSpy);

    const receivedChunks: string[] = [];
    const result = await generateContentStream("Tell me something", (chunk) => {
      receivedChunks.push(chunk);
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("Hello world! This is grounded.");
    }
    expect(receivedChunks).toEqual(["Hello ", "world! ", "This is grounded."]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = fetchSpy.mock.calls[0];
    expect(callUrl).toContain("streamGenerateContent?alt=sse");
    expect(callUrl).toContain("gemini-3.5-flash-lite");
    expect(callUrl).toContain("key=AIzaTestKey123");
    expect(JSON.parse(callOptions.body)).toEqual({
      contents: [{ parts: [{ text: "Tell me something" }] }],
    });
  });

  it("supports mediaUrl for YouTube chat on Flash route", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const sseData = [
      {
        candidates: [{ content: { parts: [{ text: "At 02:15, the speaker says..." }] } }],
      },
    ];

    const fetchSpy = vi.fn().mockResolvedValue(createMockSseResponse(sseData));
    vi.stubGlobal("fetch", fetchSpy);

    const received: string[] = [];
    const result = await generateContentStream(
      {
        prompt: "What happens in the video?",
        task: "chat",
        model: "gemini-3.5-flash",
        mediaUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      (chunk) => received.push(chunk),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("At 02:15, the speaker says...");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = fetchSpy.mock.calls[0];
    expect(callUrl).toContain("gemini-3.5-flash");
    const parsedBody = JSON.parse(callOptions.body);
    expect(parsedBody.contents[0].parts).toEqual([
      { text: "What happens in the video?" },
      { file_data: { file_uri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } },
    ]);
  });

  function createMockGroqSseResponse(chunks: string[]) {
    const encoder = new TextEncoder();
    const sseText =
      chunks
        .map(
          (text) =>
            `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
        )
        .join("") + "data: [DONE]\n\n";

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseText));
        controller.close();
      },
    });

    return {
      ok: true,
      status: 200,
      body: stream,
    };
  }

  it("retries on HTTP 429 once, notifies onStatus, and streams with primary model", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const statusUpdates: string[] = [];
    const sseData = [
      {
        candidates: [{ content: { parts: [{ text: "Stream after 429 retry!" }] } }],
      },
    ];

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => "1" },
        json: async () => ({ error: { message: "Quota exceeded" } }),
      })
      .mockResolvedValueOnce(createMockSseResponse(sseData));

    vi.stubGlobal("fetch", fetchSpy);

    const chunks: string[] = [];
    const result = await generateContentStream(
      {
        prompt: "Stream retry prompt",
        task: "chat",
        retryDelayMs: 0,
        onStatus: (s) => statusUpdates.push(s),
      },
      (chunk) => chunks.push(chunk),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("Stream after 429 retry!");
    }
    expect(chunks).toEqual(["Stream after 429 retry!"]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(statusUpdates).toContain("Sahayak is waiting for the free model.");
  });

  it("falls back to Groq stream for a text task when Gemini returns 429 twice", async () => {
    fakeStorage.settings = {
      geminiApiKey: "AIzaTestKey123",
      groqApiKey: "gsk_test_groq_key",
    };

    const statusUpdates: string[] = [];
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => "1" },
        json: async () => ({ error: { message: "Quota exceeded" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => "1" },
        json: async () => ({ error: { message: "Quota exceeded" } }),
      })
      .mockResolvedValueOnce(
        createMockGroqSseResponse(["Groq ", "streamed ", "this!"]),
      );

    vi.stubGlobal("fetch", fetchSpy);

    const chunks: string[] = [];
    const result = await generateContentStream(
      {
        prompt: "Stream prompt",
        task: "chat",
        retryDelayMs: 0,
        onStatus: (s) => statusUpdates.push(s),
      },
      (chunk) => chunks.push(chunk),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("Groq streamed this!");
    }
    expect(chunks).toEqual(["Groq ", "streamed ", "this!"]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[2][0]).toContain("api.groq.com");
    expect(statusUpdates).toContain("Sahayak is waiting for the free model.");
  });

  it("does NOT fall back to Groq stream for an image task when Gemini returns 429 twice", async () => {
    fakeStorage.settings = {
      geminiApiKey: "AIzaTestKey123",
      groqApiKey: "gsk_test_groq_key",
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "1" },
      json: async () => ({ error: { message: "Quota exceeded" } }),
    });

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateContentStream(
      {
        prompt: "Explain chart",
        task: "screenshot",
        inlineData: {
          mimeType: "image/jpeg",
          data: "mockbase64jpeg==",
        },
        retryDelayMs: 0,
      },
      () => {},
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      expect(call[0]).toContain("generativelanguage.googleapis.com");
      expect(call[0]).not.toContain("api.groq.com");
    }
  });

  it("retries on 5xx once, then falls back to Groq stream for text task", async () => {
    fakeStorage.settings = {
      geminiApiKey: "AIzaTestKey123",
      groqApiKey: "gsk_test_groq_key",
    };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "Internal Error" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "Internal Error" } }),
      })
      .mockResolvedValueOnce(
        createMockGroqSseResponse(["Groq stream after 500"]),
      );

    vi.stubGlobal("fetch", fetchSpy);

    const chunks: string[] = [];
    const result = await generateContentStream(
      {
        prompt: "Stream prompt",
        task: "chat",
        retryDelayMs: 0,
      },
      (chunk) => chunks.push(chunk),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("Groq stream after 500");
    }
    expect(chunks).toEqual(["Groq stream after 500"]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[2][0]).toContain("api.groq.com");
  });

  it("maps HTTP 429 to rate_limited error when no Groq key is saved", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "Quota exceeded" } }),
      }),
    );

    const result = await generateContentStream(
      { prompt: "Stream test", retryDelayMs: 0 },
      () => {},
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.message).toBe(ERROR_MESSAGES.rate_limited);
    }
  });

  it("maps HTTP 500 error to model_unavailable when no Groq key is saved", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "Internal Error" } }),
      }),
    );

    const result = await generateContentStream(
      { prompt: "Stream test", retryDelayMs: 0 },
      () => {},
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("model_unavailable");
      expect(result.error.message).toBe(ERROR_MESSAGES.model_unavailable);
    }
  });

  it("maps timeout to timeout error", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await generateContentStream("Stream test", () => {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("timeout");
      expect(result.error.message).toBe(ERROR_MESSAGES.timeout);
    }
  });

  it("maps empty streaming text to invalid_model_output", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const fetchSpy = vi.fn().mockResolvedValue(createMockSseResponse([]));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateContentStream("Stream test", () => {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_model_output");
      expect(result.error.message).toBe(ERROR_MESSAGES.invalid_model_output);
    }
  });

  it("supports inlineData for streaming screenshot vision task on Flash route", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const sseData = [
      {
        candidates: [{ content: { parts: [{ text: "The chart shows revenue up 20%." }] } }],
      },
    ];

    const fetchSpy = vi.fn().mockResolvedValue(createMockSseResponse(sseData));
    vi.stubGlobal("fetch", fetchSpy);

    const received: string[] = [];
    const result = await generateContentStream(
      {
        prompt: "Explain this chart",
        task: "screenshot",
        model: "gemini-3.5-flash",
        inlineData: {
          mimeType: "image/jpeg",
          data: "mockbase64jpegdata==",
        },
      },
      (chunk) => received.push(chunk),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("The chart shows revenue up 20%.");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = fetchSpy.mock.calls[0];
    expect(callUrl).toContain("gemini-3.5-flash");
    const parsedBody = JSON.parse(callOptions.body);
    expect(parsedBody.contents[0].parts).toEqual([
      { text: "Explain this chart" },
      {
        inline_data: {
          mime_type: "image/jpeg",
          data: "mockbase64jpegdata==",
        },
      },
    ]);
  });
});

describe("generateJson", () => {
  const fakeStorage: Record<string, unknown> = {};

  beforeEach(() => {
    vi.stubGlobal("__ENV_GEMINI_KEY__", "");
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: fakeStorage[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(fakeStorage, items);
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(fakeStorage)) {
      delete fakeStorage[key];
    }
  });

  interface TestPayload {
    count: number;
  }

  function parseTestPayload(raw: string) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.count === "number") {
        return ok(parsed as TestPayload);
      }
      return err("invalid_model_output");
    } catch {
      return err("invalid_model_output");
    }
  }

  function mockCandidate(text: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
      }),
    };
  }

  it("returns parsed data immediately when model returns valid JSON on first try", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const fetchSpy = vi.fn().mockResolvedValue(mockCandidate('{"count": 42}'));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateJson({
      prompt: "Give me count",
      parse: parseTestPayload,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.count).toBe(42);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain("gemini-3.5-flash-lite");
  });

  it("re-asks once with parser error when first output is invalid JSON", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockCandidate("not valid json at all"))
      .mockResolvedValueOnce(mockCandidate('{"count": 99}'));

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateJson({
      prompt: "Give me count",
      parse: parseTestPayload,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.count).toBe(99);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Second call prompt contains the repair instructions
    const secondCallBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(secondCallBody.contents[0].parts[0].text).toContain(
      "Your previous response was invalid",
    );
  });

  it("repairs Find-it output: first response invalid, second valid -> one re-ask, then success", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const validElements = new Set([1, 2, 3]);

    const fetchSpy = vi
      .fn()
      // First attempt: invalid element number not on map
      .mockResolvedValueOnce(
        mockCandidate('{"element": 999, "reason": "Bad element"}'),
      )
      // Second attempt (repair re-ask): valid element on map
      .mockResolvedValueOnce(
        mockCandidate(
          '{"element": 2, "reason": "Found submit application button"}',
        ),
      );

    vi.stubGlobal("fetch", fetchSpy);

    const { parseFindIt } = await import("./parse");

    const result = await generateJson({
      prompt: "Find submit button",
      task: "find_it",
      parse: (raw) => parseFindIt(raw, validElements),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.element).toBe(2);
      expect(result.data.reason).toBe("Found submit application button");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const repairPrompt = JSON.parse(fetchSpy.mock.calls[1][1].body).contents[0]
      .parts[0].text;
    expect(repairPrompt).toContain("Your previous response was invalid");
  });

  it("escalates to Flash model on third try when re-ask still fails", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockCandidate("bad json 1"))
      .mockResolvedValueOnce(mockCandidate("bad json 2"))
      .mockResolvedValueOnce(mockCandidate('{"count": 123}'));

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateJson({
      prompt: "Give me count",
      parse: parseTestPayload,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.count).toBe(123);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    // Third call escalated to Flash
    expect(fetchSpy.mock.calls[2][0]).toContain("gemini-3.5-flash");
    expect(fetchSpy.mock.calls[2][0]).not.toContain("flash-lite");
  });

  it("returns invalid_model_output if initial, re-ask, and Flash escalation all fail", async () => {
    fakeStorage.settings = { geminiApiKey: "AIzaTestKey123" };

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockCandidate("bad json 1"))
      .mockResolvedValueOnce(mockCandidate("bad json 2"))
      .mockResolvedValueOnce(mockCandidate("bad json 3"));

    vi.stubGlobal("fetch", fetchSpy);

    const result = await generateJson({
      prompt: "Give me count",
      parse: parseTestPayload,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_model_output");
      expect(result.error.message).toBe(ERROR_MESSAGES.invalid_model_output);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
