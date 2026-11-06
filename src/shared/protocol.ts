/** Messaging envelope and shared record types (architecture §6). */

export type ErrorCode =
  | "missing_key"
  | "sensitive_page"
  | "not_allowlisted"
  | "protected_field"
  | "needs_extra_confirm"
  | "rate_limited"
  | "model_unavailable"
  | "invalid_model_output"
  | "off_page"
  | "youtube_unsupported"
  | "step_limit"
  | "timeout"
  | "generic";

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  missing_key:
    "Add your Gemini API key in Settings before Sahayak can answer.",
  sensitive_page:
    "Sahayak will not read or act on this page because it looks like a private or payment page.",
  not_allowlisted:
    "Browser actions only run on practice pages or sites you have allowed.",
  protected_field:
    "Sahayak will not type into password, OTP, or card fields.",
  needs_extra_confirm:
    "This looks like Submit, Pay, or Send. Confirm again to continue.",
  rate_limited:
    "The free model is busy. Wait a moment or add a Groq key in Settings for text fallback.",
  model_unavailable:
    "Sahayak could not reach the model. Check the API key and try again.",
  invalid_model_output:
    "The model returned an answer Sahayak could not use. Try again.",
  off_page: "That is not on this page.",
  youtube_unsupported:
    "This video cannot be summarised. Try a public YouTube watch link.",
  step_limit:
    "This task hit the step limit. Start a new run or increase the limit in Settings.",
  timeout: "The model took too long. Try again.",
  generic: "Something went wrong, but the side panel is still usable.",
};

export type CommandName =
  | "panel/ready"
  | "tab/getActive"
  | "settings/get"
  | "settings/set"
  | "page/extract"
  | "page/selection"
  | "page/scan"
  | "page/highlight"
  | "page/act"
  | "page/seek"
  | "capture/visible"
  | "agent/propose"
  | "agent/state/get"
  | "agent/state/set"
  | "intent/pending";

export type Envelope<T = unknown> = {
  v: 1;
  id: string;
  cmd: CommandName;
  tabId?: number;
  payload?: T;
};

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err(code: ErrorCode, message?: string): Result<never> {
  return {
    ok: false,
    error: { code, message: message ?? ERROR_MESSAGES[code] },
  };
}

export type Language = "en" | "hinglish";

export type Settings = {
  geminiApiKey: string;
  groqApiKey: string;
  language: Language;
  translateLanguage: string;
  dryRunDefault: boolean;
  stepLimit: number;
  extraAllowlist: string[];
};

const defaultEnvKey =
  typeof __ENV_GEMINI_KEY__ !== "undefined" ? __ENV_GEMINI_KEY__ : "";

const defaultEnvGroqKey =
  typeof __ENV_GROQ_KEY__ !== "undefined" ? __ENV_GROQ_KEY__ : "";

export const DEFAULT_SETTINGS: Settings = {
  geminiApiKey: defaultEnvKey,
  groqApiKey: defaultEnvGroqKey,
  language: "en",
  translateLanguage: "hi",
  dryRunDefault: false,
  stepLimit: 8,
  extraAllowlist: [],
};

export type UserProfile = {
  name: string;
  college: string;
  skills: string;
  links: string;
  preferredTone: string;
  preferredLanguage?: Language;
  email?: string;
};

export const DEFAULT_PROFILE: UserProfile = {
  name: "",
  college: "",
  skills: "",
  links: "",
  preferredTone: "polite and concise",
  preferredLanguage: "en",
  email: "",
};

export type Skill = {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
};

export const STARTER_SKILLS: Skill[] = [
  {
    id: "starter-exam-notes",
    name: "Exam notes",
    prompt:
      "Extract structured exam study notes from this content: include definitions, key formulas/concepts, high-yield points, and sample exam questions.",
    createdAt: 1700000000000,
  },
  {
    id: "starter-hinglish-explain",
    name: "Explain in Hinglish",
    prompt:
      "Explain this content simply in conversational Hinglish (Hindi in Roman script mixed with English). Use everyday analogies and bullet points.",
    createdAt: 1700000000001,
  },
  {
    id: "starter-reply-email",
    name: "Reply to this email politely",
    prompt:
      "Draft a polite, professional, and well-structured email reply to this message. Address all key points and maintain a courteous tone.",
    createdAt: 1700000000002,
  },
  {
    id: "starter-fill-form",
    name: "Fill this form from my profile",
    prompt:
      "Fill this form using my saved profile information. Match each field accurately and prepare values.",
    createdAt: 1700000000003,
  },
];

export type ActiveTabInfo = {
  tabId: number;
  url: string;
  title: string;
};

export type PendingIntentKind = "explain" | "translate" | "draft";

export type PendingIntent = {
  kind: PendingIntentKind;
  selectionText: string;
  tabId: number;
  url: string;
  createdAt: number;
};

export type PanelReadyData = {
  pendingIntent: PendingIntent | null;
};

export function newEnvelopeId(): string {
  return crypto.randomUUID();
}

export type PageKind = "article" | "youtube" | "generic";

export type PageExtract = {
  kind: PageKind;
  title: string;
  url: string;
  text: string;
  byline?: string;
  siteName?: string;
  videoId?: string;
  canonicalUrl?: string;
};

export type Chapter = {
  timestamp: string;
  note: string;
};

export type SummaryResult = {
  tldr: string;
  points: string[];
  next: string;
  chapters?: Chapter[];
};

export type ActionNode = {
  n: number;
  role: string;
  name: string;
  type?: string;
  valuePreview?: string;
  protected?: boolean;
};

export type ActionMapData = {
  url: string;
  elements: ActionNode[];
};

export type HighlightPayload = {
  n: number;
};

export type AgentActionType = "click" | "type" | "select" | "scroll" | "done";

export type AgentStep = {
  type: AgentActionType;
  element?: number;
  value?: string;
  reason: string;
};

export type Proposal = {
  id: string;
  runId: string;
  stepIndex: number;
  step: AgentStep;
  targetName?: string;
  targetRole?: string;
  isConsequential?: boolean;
  isProtected?: boolean;
};

export type ActPayload = {
  proposalId?: string;
  runId?: string;
  stepIndex?: number;
  n?: number;
  type: AgentActionType;
  value?: string;
  confirmedConsequential?: boolean;
};

export type ActionDecision =
  | "approved"
  | "skipped"
  | "stopped"
  | "blocked"
  | "dry_run";

export type ActionLogEntry = {
  id: string;
  stepIndex: number;
  type: AgentActionType;
  target?: string;
  value?: string;
  reason: string;
  decision: ActionDecision;
  timestamp: number;
};

export type ActionLogSession = {
  sessionId: string;
  goal: string;
  startedAt: number;
  endedAt?: number;
  status: AgentRunStatus;
  entries: ActionLogEntry[];
};

export type AgentRunStatus =
  | "idle"
  | "scanning"
  | "thinking"
  | "waiting_approval"
  | "executing"
  | "done"
  | "stopped"
  | "error";

export type AgentRunState = {
  runId: string;
  goal: string;
  tabId: number;
  stepIndex: number;
  status: AgentRunStatus;
  lastProposal?: Proposal | null;
  approvedProposalId?: string | null;
  skippedElements?: number[];
  dryRun?: boolean;
  error?: { code: ErrorCode; message: string } | null;
};

export type SeekPayload = {
  seconds: number;
  videoId?: string;
};
