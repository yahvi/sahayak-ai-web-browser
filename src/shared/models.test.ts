import { describe, expect, it } from "vitest";
import {
  GEMINI_MODELS,
  GROQ_MODELS,
  getTaskRoute,
  TASK_ROUTES,
  type TaskKind,
} from "./models";

describe("models", () => {
  it("pins model strings in models.ts only", () => {
    expect(GEMINI_MODELS.flashLite).toBe("gemini-3.5-flash-lite");
    expect(GEMINI_MODELS.flash).toBe("gemini-3.5-flash");
    expect(GROQ_MODELS.default).toBe("llama-3.3-70b-versatile");
  });

  it("defines routes for all 8 architecture tasks", () => {
    const requiredTasks: TaskKind[] = [
      "free_ask",
      "summary",
      "youtube_summary",
      "chat",
      "explain",
      "screenshot",
      "find_it",
      "agent_act",
    ];

    for (const task of requiredTasks) {
      const route = getTaskRoute(task);
      expect(route).toBeDefined();
      expect(route.task).toBe(task);
      expect(route.provider).toBe("gemini");
      expect(route.primary).toBeTruthy();
    }
  });

  it("enforces Groq fallback rules from architecture §9.1", () => {
    // YouTube and screenshot vision must NOT fall back to Groq
    expect(TASK_ROUTES.youtube_summary.allowGroqFallback).toBe(false);
    expect(TASK_ROUTES.screenshot.allowGroqFallback).toBe(false);

    // Text tasks allow Groq fallback
    expect(TASK_ROUTES.free_ask.allowGroqFallback).toBe(true);
    expect(TASK_ROUTES.summary.allowGroqFallback).toBe(true);
    expect(TASK_ROUTES.chat.allowGroqFallback).toBe(true);
    expect(TASK_ROUTES.explain.allowGroqFallback).toBe(true);
    expect(TASK_ROUTES.find_it.allowGroqFallback).toBe(true);
    expect(TASK_ROUTES.agent_act.allowGroqFallback).toBe(true);
  });

  it("routes YouTube summary and screenshot vision to Flash", () => {
    expect(TASK_ROUTES.youtube_summary.primary).toBe(GEMINI_MODELS.flash);
    expect(TASK_ROUTES.screenshot.primary).toBe(GEMINI_MODELS.flash);
  });

  it("configures JSON repair escalation model to Flash for find_it and agent_act", () => {
    expect(TASK_ROUTES.find_it.escalateModel).toBe(GEMINI_MODELS.flash);
    expect(TASK_ROUTES.agent_act.escalateModel).toBe(GEMINI_MODELS.flash);
  });
});
