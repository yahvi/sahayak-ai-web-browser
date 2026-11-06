import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STARTER_SKILLS, type Skill } from "./protocol";
import { validateSkillsImport } from "./skills";
import {
  deleteSkill,
  getSkills,
  resetSkills,
  saveSkill,
  setSkills,
} from "./storage";

describe("Skills System (Slice 15)", () => {
  const localStorageMock: Record<string, unknown> = {};

  beforeEach(() => {
    for (const k of Object.keys(localStorageMock)) delete localStorageMock[k];

    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (keys?: string | string[]) => {
            if (typeof keys === "string") {
              return { [keys]: localStorageMock[keys] };
            }
            if (Array.isArray(keys)) {
              const res: Record<string, unknown> = {};
              for (const k of keys) res[k] = localStorageMock[k];
              return res;
            }
            return { ...localStorageMock };
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(localStorageMock, items);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) delete localStorageMock[k];
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Starter skills & storage CRUD", () => {
    it("loads default starter skills on first run", async () => {
      const skills = await getSkills();
      expect(skills.length).toBe(4);
      expect(skills.map((s) => s.name)).toEqual([
        "Exam notes",
        "Explain in Hinglish",
        "Reply to this email politely",
        "Fill this form from my profile",
      ]);
    });

    it("saves a new custom skill", async () => {
      const custom = await saveSkill({
        name: "Create LinkedIn post",
        prompt: "Draft an engaging LinkedIn post summarizing key achievements from this page.",
      });

      expect(custom.id).toBeDefined();
      expect(custom.name).toBe("Create LinkedIn post");

      const all = await getSkills();
      expect(all.length).toBe(5);
      expect(all.find((s) => s.id === custom.id)?.name).toBe("Create LinkedIn post");
    });

    it("updates an existing skill by id", async () => {
      const saved = await saveSkill({
        id: "starter-exam-notes",
        name: "Updated Exam Notes",
        prompt: "Updated prompt recipe for exams.",
      });

      expect(saved.id).toBe("starter-exam-notes");
      expect(saved.name).toBe("Updated Exam Notes");

      const all = await getSkills();
      expect(all.length).toBe(4);
      expect(all.find((s) => s.id === "starter-exam-notes")?.name).toBe("Updated Exam Notes");
    });

    it("deletes a skill by id", async () => {
      await getSkills(); // seeds starters
      await deleteSkill("starter-hinglish-explain");

      const remaining = await getSkills();
      expect(remaining.length).toBe(3);
      expect(remaining.find((s) => s.id === "starter-hinglish-explain")).toBeUndefined();
    });

    it("resets back to starter skills", async () => {
      await setSkills([]);
      const empty = await getSkills();
      expect(empty.length).toBe(4); // Re-seeds if empty

      await deleteSkill("starter-exam-notes");
      const afterDel = await getSkills();
      expect(afterDel.length).toBe(3);

      const restored = await resetSkills();
      expect(restored.length).toBe(4);
      expect(restored[0].id).toBe("starter-exam-notes");
    });
  });

  describe("validateSkillsImport (Slice 15 step 3)", () => {
    it("accepts a valid array of skills", () => {
      const valid = [
        {
          id: "custom-1",
          name: "Recipe 1",
          prompt: "Do task 1",
          createdAt: 1700000000000,
        },
        {
          name: "Recipe 2",
          prompt: "Do task 2",
        },
      ];

      const res = validateSkillsImport(valid);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.length).toBe(2);
        expect(res.data[0].name).toBe("Recipe 1");
        expect(res.data[1].id).toBeDefined();
        expect(res.data[1].createdAt).toBeDefined();
      }
    });

    it("rejects non-array JSON inputs", () => {
      expect(validateSkillsImport(null).ok).toBe(false);
      expect(validateSkillsImport({}).ok).toBe(false);
      expect(validateSkillsImport("not-an-array").ok).toBe(false);
    });

    it("rejects non-object skill entries", () => {
      const res = validateSkillsImport(["not-an-object", 123]);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("not a valid object");
      }
    });

    it("strictly rejects unknown or executable fields", () => {
      const dangerous = [
        {
          id: "1",
          name: "Skill 1",
          prompt: "Valid prompt",
          execute: "eval('malicious')",
          runScript: true,
        },
      ];

      const res = validateSkillsImport(dangerous);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("prohibited or unknown field");
      }
    });

    it("rejects empty skill names or empty prompts", () => {
      const emptyName = [{ name: "   ", prompt: "Valid prompt" }];
      const resName = validateSkillsImport(emptyName);
      expect(resName.ok).toBe(false);
      if (!resName.ok) {
        expect(resName.error).toContain("non-empty name");
      }

      const emptyPrompt = [{ name: "Valid name", prompt: "" }];
      const resPrompt = validateSkillsImport(emptyPrompt);
      expect(resPrompt.ok).toBe(false);
      if (!resPrompt.ok) {
        expect(resPrompt.error).toContain("non-empty prompt");
      }
    });

    it("rejects unsafe script protocols in prompt text", () => {
      const scriptPrompt = [
        {
          name: "Bad Skill",
          prompt: "javascript:alert('xss')",
        },
      ];
      const res = validateSkillsImport(scriptPrompt);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("prohibited script prefix");
      }
    });

    it("round-trips exported JSON through validator", () => {
      const json = JSON.stringify(STARTER_SKILLS);
      const parsed = JSON.parse(json);

      const res = validateSkillsImport(parsed);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual(STARTER_SKILLS);
      }
    });
  });
});

