import {
  err,
  ok,
  type AgentActionType,
  type AgentStep,
  type Chapter,
  type Result,
  type SummaryResult,
} from "../shared/protocol";

/**
 * Strips markdown code fences or surrounding text to extract a clean JSON string.
 */
export function extractJsonString(raw: string): string {
  let cleaned = raw.trim();

  // Strip markdown code fences if wrapped in them
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // If there's still text around the JSON, extract between the first { and last }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

/**
 * Parses model output into a validated SummaryResult (architecture §9.4).
 * Enforces:
 * - non-empty `tldr`
 * - array of `points`, keeping at most 5
 * - `next` step string
 * - optional `chapters` array with { timestamp, note }
 * Returns `invalid_model_output` on failure.
 */
export function parseSummary(raw: string): Result<SummaryResult> {
  try {
    const cleaned = extractJsonString(raw);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    if (!parsed || typeof parsed !== "object") {
      return err("invalid_model_output");
    }

    // Validate tldr
    if (typeof parsed.tldr !== "string" || !parsed.tldr.trim()) {
      return err("invalid_model_output");
    }
    const tldr = parsed.tldr.trim();

    // Validate points
    if (!Array.isArray(parsed.points) || parsed.points.length === 0) {
      return err("invalid_model_output");
    }

    const points: string[] = [];
    for (const item of parsed.points) {
      if (typeof item === "string" && item.trim()) {
        points.push(item.trim());
      }
    }

    if (points.length === 0) {
      return err("invalid_model_output");
    }

    // Keep at most 5 points as per spec
    const cappedPoints = points.slice(0, 5);

    // Validate next
    const next = typeof parsed.next === "string" ? parsed.next.trim() : "";

    // Optional chapters (for YouTube summaries in Slice 4)
    let chapters: Chapter[] | undefined = undefined;
    if (Array.isArray(parsed.chapters)) {
      const validChapters: Chapter[] = [];
      for (const ch of parsed.chapters) {
        if (
          ch &&
          typeof ch === "object" &&
          typeof (ch as Record<string, unknown>).timestamp === "string" &&
          typeof (ch as Record<string, unknown>).note === "string"
        ) {
          validChapters.push({
            timestamp: ((ch as Record<string, unknown>).timestamp as string).trim(),
            note: ((ch as Record<string, unknown>).note as string).trim(),
          });
        }
      }
      if (validChapters.length > 0) {
        chapters = validChapters;
      }
    }

    return ok({
      tldr,
      points: cappedPoints,
      next,
      ...(chapters ? { chapters } : {}),
    });
  } catch {
    return err("invalid_model_output");
  }
}

export type FindItResult = {
  element: number | null;
  reason: string;
};

/**
 * Parses model output for Find-it tasks (architecture §9.4).
 * Expects JSON: { element: <integer | null>, reason: <string> }
 * Validates that element is an integer on the current map (if validElements provided).
 * Returns invalid_model_output on invalid JSON, non-integer, missing element, or element not on map.
 */
export function parseFindIt(
  raw: string,
  validElements?: Iterable<number>,
): Result<FindItResult> {
  try {
    const cleaned = extractJsonString(raw);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    if (!parsed || typeof parsed !== "object") {
      return err("invalid_model_output");
    }

    if (!("element" in parsed)) {
      return err("invalid_model_output");
    }

    const rawElement = parsed.element;

    // Declined case: element is explicitly null
    if (rawElement === null) {
      const reason =
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : "That is not on this page.";
      return ok({ element: null, reason });
    }

    // Must be an integer number
    if (typeof rawElement !== "number" || !Number.isInteger(rawElement)) {
      return err("invalid_model_output");
    }

    // Must be present on the current map if validElements is provided
    if (validElements) {
      const validSet =
        validElements instanceof Set ? validElements : new Set(validElements);
      if (!validSet.has(rawElement)) {
        return err("invalid_model_output");
      }
    }

    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : `Found element [${rawElement}].`;

    return ok({
      element: rawElement,
      reason,
    });
  } catch {
    return err("invalid_model_output");
  }
}



/**
 * Parses model output for Agent Next-Action steps (architecture §9.4 & Slice 12).
 * Expects JSON: { type: "click" | "type" | "select" | "scroll" | "done", element?, value?, reason: string }
 * Enforces:
 * - valid non-empty reason
 * - known action type
 * - integer element on the current map for DOM actions
 * - string value for "type" action
 * - "done" requires no element
 */
export function parseAgentStep(
  raw: string,
  validElements?: Iterable<number>,
): Result<AgentStep> {
  try {
    const cleaned = extractJsonString(raw);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    if (!parsed || typeof parsed !== "object") {
      return err("invalid_model_output");
    }

    // reason is required and must be non-empty string
    if (typeof parsed.reason !== "string" || !parsed.reason.trim()) {
      return err("invalid_model_output");
    }
    const reason = parsed.reason.trim();

    // type must be one of the supported action types
    const validTypes: AgentActionType[] = [
      "click",
      "type",
      "select",
      "scroll",
      "done",
    ];
    if (
      typeof parsed.type !== "string" ||
      !validTypes.includes(parsed.type as AgentActionType)
    ) {
      return err("invalid_model_output");
    }
    const type = parsed.type as AgentActionType;

    // "done" finishes the run and does not require an element
    if (type === "done") {
      return ok({
        type: "done",
        reason,
      });
    }

    // For click, type, select, scroll: element must be an integer
    if (
      typeof parsed.element !== "number" ||
      !Number.isInteger(parsed.element)
    ) {
      return err("invalid_model_output");
    }
    const element = parsed.element;

    if (validElements) {
      const validSet =
        validElements instanceof Set ? validElements : new Set(validElements);
      if (!validSet.has(element)) {
        return err("invalid_model_output");
      }
    }

    // For "type": value is required and must be a string
    let value: string | undefined = undefined;
    if (type === "type") {
      if (typeof parsed.value !== "string") {
        return err("invalid_model_output");
      }
      value = parsed.value;
    } else if (type === "select" && typeof parsed.value === "string") {
      value = parsed.value;
    }

    return ok({
      type,
      element,
      ...(value !== undefined ? { value } : {}),
      reason,
    });
  } catch {
    return err("invalid_model_output");
  }
}
