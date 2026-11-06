import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "./limits";
import type { ActionLogEntry, AgentRunState, Proposal } from "./protocol";
import {
  appendActionLogEntry,
  clearActionLogs,
  clearAgentRun,
  clearProfile,
  getActionLogIndex,
  getActionLogSession,
  getAllActionLogs,
  getAgentRun,
  getProfile,
  setAgentRun,
  setProfile,
} from "./storage";

describe("storage — agentRun and actionLog (Slice 13)", () => {
  const localStorageMock: Record<string, unknown> = {};
  const sessionStorageMock: Record<string, unknown> = {};

  beforeEach(() => {
    for (const k of Object.keys(localStorageMock)) delete localStorageMock[k];
    for (const k of Object.keys(sessionStorageMock)) delete sessionStorageMock[k];

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
        session: {
          get: vi.fn(async (keys?: string | string[]) => {
            if (typeof keys === "string") {
              return { [keys]: sessionStorageMock[keys] };
            }
            if (Array.isArray(keys)) {
              const res: Record<string, unknown> = {};
              for (const k of keys) res[k] = sessionStorageMock[k];
              return res;
            }
            return { ...sessionStorageMock };
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(sessionStorageMock, items);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) delete sessionStorageMock[k];
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("agentRun persistence", () => {
    it("serialising agentRun round-trips proposal id and step index", async () => {
      const mockProposal: Proposal = {
        id: "proposal-xyz-456",
        runId: "run-abc-123",
        stepIndex: 3,
        step: {
          type: "type",
          element: 5,
          value: "Priya Sharma",
          reason: "Fill applicant full name",
        },
        targetName: "Full Name",
        targetRole: "textbox",
        isConsequential: false,
        isProtected: false,
      };

      const runState: AgentRunState = {
        runId: "run-abc-123",
        goal: "Fill internship form",
        tabId: 42,
        stepIndex: 3,
        status: "waiting_approval",
        lastProposal: mockProposal,
        approvedProposalId: "proposal-xyz-456",
        skippedElements: [1, 2],
        dryRun: false,
      };

      await setAgentRun(runState);

      const retrieved = await getAgentRun();
      expect(retrieved).not.toBeNull();
      expect(retrieved?.runId).toBe("run-abc-123");
      expect(retrieved?.stepIndex).toBe(3);
      expect(retrieved?.lastProposal?.id).toBe("proposal-xyz-456");
      expect(retrieved?.approvedProposalId).toBe("proposal-xyz-456");
      expect(retrieved?.lastProposal?.step.type).toBe("type");
      expect(retrieved?.lastProposal?.step.value).toBe("Priya Sharma");
      expect(retrieved?.skippedElements).toEqual([1, 2]);

      await clearAgentRun();
      const cleared = await getAgentRun();
      expect(cleared).toBeNull();
    });
  });

  describe("actionLog and eviction", () => {
    it("appends action log entries with decision, stepIndex, and timestamp", async () => {
      const sessionId = "session-test-1";
      const goal = "Apply for internship";

      await appendActionLogEntry(
        sessionId,
        goal,
        {
          stepIndex: 0,
          type: "type",
          target: '[1] textbox "Full Name"',
          value: "Alice",
          reason: "Enter applicant name",
          decision: "approved",
        },
        "waiting_approval",
      );

      await appendActionLogEntry(
        sessionId,
        goal,
        {
          stepIndex: 1,
          type: "click",
          target: '[2] button "Submit"',
          reason: "Submit form",
          decision: "dry_run",
        },
        "done",
      );

      const session = await getActionLogSession(sessionId);
      expect(session).not.toBeNull();
      expect(session?.goal).toBe(goal);
      expect(session?.status).toBe("done");
      expect(session?.entries.length).toBe(2);

      expect(session?.entries[0].stepIndex).toBe(0);
      expect(session?.entries[0].decision).toBe("approved");
      expect(session?.entries[0].type).toBe("type");
      expect(session?.entries[0].target).toContain("Full Name");
      expect(session?.entries[0].timestamp).toBeGreaterThan(0);

      expect(session?.entries[1].stepIndex).toBe(1);
      expect(session?.entries[1].decision).toBe("dry_run");
      expect(session?.entries[1].type).toBe("click");
    });

    it("log index evicts past 20 sessions", async () => {
      expect(LIMITS.actionLogSessions).toBe(20);

      // Append entries for 25 distinct sessions
      for (let i = 1; i <= 25; i++) {
        await appendActionLogEntry(
          `session-${i}`,
          `Goal ${i}`,
          {
            stepIndex: 0,
            type: "click",
            reason: `Step for session ${i}`,
            decision: "approved",
          },
          "done",
        );
      }

      const index = await getActionLogIndex();
      // Must be capped at exactly 20
      expect(index.length).toBe(20);

      // Most recent should be session-25 down to session-6
      expect(index[0]).toBe("session-25");
      expect(index[19]).toBe("session-6");

      // Sessions 1 through 5 should have been evicted
      expect(index).not.toContain("session-1");
      expect(index).not.toContain("session-2");
      expect(index).not.toContain("session-3");
      expect(index).not.toContain("session-4");
      expect(index).not.toContain("session-5");

      // Verify the evicted sessions are no longer in storage
      const evictedSession = await getActionLogSession("session-1");
      expect(evictedSession).toBeNull();

      // Verify retained sessions are accessible
      const retainedSession = await getActionLogSession("session-25");
      expect(retainedSession).not.toBeNull();
      expect(retainedSession?.goal).toBe("Goal 25");
    });

    it("records stopped and skipped decisions correctly", async () => {
      const sessionId = "session-decisions";
      const goal = "Test skipped and stopped";

      await appendActionLogEntry(
        sessionId,
        goal,
        {
          stepIndex: 0,
          type: "click",
          target: '[3] button "Skip Me"',
          reason: "User skipped button",
          decision: "skipped",
        },
        "waiting_approval",
      );

      await appendActionLogEntry(
        sessionId,
        goal,
        {
          stepIndex: 1,
          type: "type",
          target: '[4] input "Search"',
          reason: "User hit kill switch",
          decision: "stopped",
        },
        "stopped",
      );

      const session = await getActionLogSession(sessionId);
      expect(session?.status).toBe("stopped");
      expect(session?.entries[0].decision).toBe("skipped");
      expect(session?.entries[1].decision).toBe("stopped");
    });

    it("clears all action logs cleanly", async () => {
      await appendActionLogEntry("s1", "g1", {
        stepIndex: 0,
        type: "click",
        reason: "r",
        decision: "approved",
      });

      await clearActionLogs();

      const index = await getActionLogIndex();
      expect(index).toEqual([]);
      const s1 = await getActionLogSession("s1");
      expect(s1).toBeNull();
    });
  });

  describe("profile memory (Slice 14)", () => {
    it("returns default profile when empty", async () => {
      const profile = await getProfile();
      expect(profile.name).toBe("");
      expect(profile.college).toBe("");
      expect(profile.preferredTone).toBe("polite and concise");
      expect(profile.preferredLanguage).toBe("en");
    });

    it("saves and retrieves full user profile", async () => {
      const saved = await setProfile({
        name: "Priya Sharma",
        email: "priya@college.edu",
        college: "IIT Delhi",
        skills: "Python, React, TypeScript",
        links: "github.com/priyasharma",
        preferredTone: "formal and professional",
        preferredLanguage: "hinglish",
      });

      expect(saved.name).toBe("Priya Sharma");
      expect(saved.college).toBe("IIT Delhi");
      expect(saved.preferredLanguage).toBe("hinglish");

      const retrieved = await getProfile();
      expect(retrieved.name).toBe("Priya Sharma");
      expect(retrieved.email).toBe("priya@college.edu");
      expect(retrieved.college).toBe("IIT Delhi");
      expect(retrieved.skills).toBe("Python, React, TypeScript");
      expect(retrieved.links).toBe("github.com/priyasharma");
      expect(retrieved.preferredTone).toBe("formal and professional");
      expect(retrieved.preferredLanguage).toBe("hinglish");
    });

    it("never stores password, otp, or card fields (safety requirement §7.1)", async () => {
      const saved = await setProfile({
        name: "Rohan Verma",
        college: "BITS Pilani",
        password: "secretPassword123",
        userPassword: "anotherSecretPassword",
        otp: "123456",
        pin: "9999",
        cvv: "123",
      } as unknown as Record<string, unknown>);

      expect(saved.name).toBe("Rohan Verma");
      expect((saved as unknown as Record<string, unknown>).password).toBeUndefined();
      expect((saved as unknown as Record<string, unknown>).userPassword).toBeUndefined();
      expect((saved as unknown as Record<string, unknown>).otp).toBeUndefined();
      expect((saved as unknown as Record<string, unknown>).pin).toBeUndefined();
      expect((saved as unknown as Record<string, unknown>).cvv).toBeUndefined();

      const retrieved = await getProfile();
      expect((retrieved as unknown as Record<string, unknown>).password).toBeUndefined();
    });

    it("clears profile back to default", async () => {
      await setProfile({ name: "Alice" });
      await clearProfile();
      const reset = await getProfile();
      expect(reset.name).toBe("");
    });
  });
});

