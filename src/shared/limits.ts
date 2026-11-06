/** Single source of truth for caps (architecture §15). */

export const LIMITS = {
  extractChars: 12_000,
  selectionChars: 4_000,
  chatHistoryTurns: 8,
  agentMaxSteps: 8,
  modelTimeoutMs: 30_000,
  retryAfterCapSeconds: 8,
  pendingIntentTtlMs: 2 * 60 * 1000,
  actionLogSessions: 20,
  screenshotLongestEdge: 1280,
  screenshotJpegQuality: 0.7,
  jsonRepairReasks: 1,
  jsonRepairFlashEscalations: 1,
} as const;
