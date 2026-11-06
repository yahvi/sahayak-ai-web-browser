/**
 * Model identifiers and routing (architecture §9.1).
 * Pin provider model id strings in this file only.
 */

export const GEMINI_MODELS = {
  flashLite: "gemini-3.5-flash-lite",
  flash: "gemini-3.5-flash",
} as const;

export const GROQ_MODELS = {
  default: "llama-3.3-70b-versatile",
} as const;

export type TaskKind =
  | "free_ask"
  | "summary"
  | "youtube_summary"
  | "chat"
  | "explain"
  | "translate"
  | "draft_reply"
  | "screenshot"
  | "find_it"
  | "agent_act";

export interface ModelRoute {
  task: TaskKind;
  primary: string;
  provider: "gemini";
  allowGroqFallback: boolean;
  escalateModel?: string;
  notes?: string;
}

export const TASK_ROUTES: Record<TaskKind, ModelRoute> = {
  free_ask: {
    task: "free_ask",
    primary: GEMINI_MODELS.flashLite,
    provider: "gemini",
    allowGroqFallback: true,
  },
  summary: {
    task: "summary",
    primary: GEMINI_MODELS.flashLite,
    provider: "gemini",
    allowGroqFallback: true,
  },
  youtube_summary: {
    task: "youtube_summary",
    primary: GEMINI_MODELS.flash,
    provider: "gemini",
    allowGroqFallback: false,
    notes: "Gemini Flash with YouTube / file URI. If rejected, show youtube_unsupported.",
  },
  chat: {
    task: "chat",
    primary: GEMINI_MODELS.flashLite,
    provider: "gemini",
    allowGroqFallback: true,
  },
  explain: {
    task: "explain",
    primary: GEMINI_MODELS.flashLite,
    provider: "gemini",
    allowGroqFallback: true,
  },
  translate: {
    task: "translate",
    primary: GEMINI_MODELS.flashLite,
    provider: "gemini",
    allowGroqFallback: true,
  },
  draft_reply: {
    task: "draft_reply",
    primary: GEMINI_MODELS.flashLite,
    provider: "gemini",
    allowGroqFallback: true,
  },
  screenshot: {
    task: "screenshot",
    primary: GEMINI_MODELS.flash,
    provider: "gemini",
    allowGroqFallback: false,
    notes: "Cropped JPEG, longest edge <= 1280, quality ~0.7.",
  },
  find_it: {
    task: "find_it",
    primary: GEMINI_MODELS.flashLite,
    provider: "gemini",
    allowGroqFallback: true,
    escalateModel: GEMINI_MODELS.flash,
    notes: "Invalid JSON: re-ask once, then Flash once.",
  },
  agent_act: {
    task: "agent_act",
    primary: GEMINI_MODELS.flashLite,
    provider: "gemini",
    allowGroqFallback: true,
    escalateModel: GEMINI_MODELS.flash,
    notes: "Agent next-action JSON; same repair path.",
  },
};

export function getTaskRoute(task: TaskKind): ModelRoute {
  return TASK_ROUTES[task];
}
