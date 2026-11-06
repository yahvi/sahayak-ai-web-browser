import type { Skill } from "./protocol";

export type SkillsValidationResult =
  | { ok: true; data: Skill[] }
  | { ok: false; error: string };

/**
 * Validates imported JSON array of skills (Slice 15 step 3).
 * Strictly rejects:
 * - non-array inputs or non-object items
 * - unknown or executable fields (prototype pollution, script properties)
 * - empty name or prompt
 * - unsafe execution URLs (javascript:, data:text/html)
 */
export function validateSkillsImport(raw: unknown): SkillsValidationResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Imported file must contain a JSON array of skills." };
  }

  const validSkills: Skill[] = [];
  const allowedKeys = new Set(["id", "name", "prompt", "createdAt"]);

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: `Skill at index ${i} is not a valid object.` };
    }

    const obj = item as Record<string, unknown>;

    // Reject unknown or prohibited executable fields
    for (const key of Object.keys(obj)) {
      if (!allowedKeys.has(key)) {
        return {
          ok: false,
          error: `Skill at index ${i} contains prohibited or unknown field: "${key}".`,
        };
      }
    }

    if (typeof obj.name !== "string" || !obj.name.trim()) {
      return { ok: false, error: `Skill at index ${i} must have a non-empty name.` };
    }

    if (typeof obj.prompt !== "string" || !obj.prompt.trim()) {
      return { ok: false, error: `Skill at index ${i} must have a non-empty prompt.` };
    }

    // Safety: reject script protocols in prompt
    const lowerPrompt = obj.prompt.toLowerCase().trim();
    if (
      lowerPrompt.startsWith("javascript:") ||
      lowerPrompt.startsWith("data:text/html")
    ) {
      return { ok: false, error: `Skill at index ${i} contains prohibited script prefix.` };
    }

    const id =
      typeof obj.id === "string" && obj.id.trim()
        ? obj.id.trim()
        : typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `skill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const createdAt =
      typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt)
        ? obj.createdAt
        : Date.now();

    validSkills.push({
      id,
      name: obj.name.trim(),
      prompt: obj.prompt.trim(),
      createdAt,
    });
  }

  return { ok: true, data: validSkills };
}

