import { LIMITS } from "./limits";
import {
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  STARTER_SKILLS,
  type ActionLogEntry,
  type ActionLogSession,
  type AgentRunState,
  type AgentRunStatus,
  type PendingIntent,
  type Settings,
  type Skill,
  type UserProfile,
} from "./protocol";

const SETTINGS_KEY = "settings";
const PROFILE_KEY = "profile";
const SKILLS_KEY = "skills";
const PENDING_INTENT_KEY = "pendingIntent";
const AGENT_RUN_KEY = "agentRun";
const ACTION_LOG_INDEX_KEY = "actionLogIndex";
const ACTION_LOG_PREFIX = "actionLog:";

function mergeSettings(raw: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...raw };
}

function mergeProfile(raw: Partial<UserProfile> | undefined): UserProfile {
  return { ...DEFAULT_PROFILE, ...raw };
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(result[SETTINGS_KEY] as Partial<Settings> | undefined);
}

export async function setSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getProfile(): Promise<UserProfile> {
  try {
    const result = await chrome.storage.local.get(PROFILE_KEY);
    return mergeProfile(result[PROFILE_KEY] as Partial<UserProfile> | undefined);
  } catch {
    return DEFAULT_PROFILE;
  }
}

export async function setProfile(
  patch: Partial<UserProfile> & Record<string, unknown>,
): Promise<UserProfile> {
  const current = await getProfile();

  // Strip any disallowed keys such as passwords or secrets (architecture §7.1)
  const safePatch: Partial<UserProfile> = {};
  for (const [k, v] of Object.entries(patch)) {
    const lowerKey = k.toLowerCase();
    if (
      lowerKey.includes("password") ||
      lowerKey.includes("pwd") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("pin") ||
      lowerKey.includes("otp") ||
      lowerKey.includes("cvv")
    ) {
      continue;
    }
    (safePatch as Record<string, unknown>)[k] = v;
  }

  const next: UserProfile = { ...current, ...safePatch };
  await chrome.storage.local.set({ [PROFILE_KEY]: next });
  return next;
}

export async function clearProfile(): Promise<void> {
  try {
    await chrome.storage.local.remove(PROFILE_KEY);
  } catch {
    // ignore
  }
}

export async function getSkills(): Promise<Skill[]> {
  try {
    const result = await chrome.storage.local.get(SKILLS_KEY);
    const stored = result[SKILLS_KEY] as Skill[] | undefined;
    if (Array.isArray(stored) && stored.length > 0) {
      return stored;
    }
    // Seed with starter skills if empty (Slice 15 step 1)
    await chrome.storage.local.set({ [SKILLS_KEY]: STARTER_SKILLS });
    return [...STARTER_SKILLS];
  } catch {
    return [...STARTER_SKILLS];
  }
}

export async function setSkills(skills: Skill[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [SKILLS_KEY]: skills });
  } catch {
    // ignore
  }
}

export async function saveSkill(
  skill: Omit<Skill, "id" | "createdAt"> & { id?: string; createdAt?: number },
): Promise<Skill> {
  const current = await getSkills();
  const id =
    skill.id ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `skill-${Date.now()}`);

  const createdAt = skill.createdAt ?? Date.now();
  const newOrUpdated: Skill = {
    id,
    name: skill.name.trim(),
    prompt: skill.prompt.trim(),
    createdAt,
  };

  const existingIndex = current.findIndex((s) => s.id === id);
  let next: Skill[];
  if (existingIndex >= 0) {
    next = [...current];
    next[existingIndex] = newOrUpdated;
  } else {
    next = [...current, newOrUpdated];
  }

  await setSkills(next);
  return newOrUpdated;
}

export async function deleteSkill(id: string): Promise<void> {
  const current = await getSkills();
  const next = current.filter((s) => s.id !== id);
  await setSkills(next);
}

export async function resetSkills(): Promise<Skill[]> {
  await setSkills(STARTER_SKILLS);
  return [...STARTER_SKILLS];
}

export async function getPendingIntent(): Promise<PendingIntent | null> {
  try {
    const result = await chrome.storage.session.get(PENDING_INTENT_KEY);
    const intent = result[PENDING_INTENT_KEY] as PendingIntent | undefined;
    if (!intent) return null;
    if (Date.now() - intent.createdAt > LIMITS.pendingIntentTtlMs) {
      await chrome.storage.session.remove(PENDING_INTENT_KEY);
      return null;
    }
    return intent;
  } catch {
    return null;
  }
}

export async function setPendingIntent(
  intent: PendingIntent | null,
): Promise<void> {
  if (intent === null) {
    try {
      await chrome.storage.session.remove(PENDING_INTENT_KEY);
    } catch {
      // ignore
    }
    return;
  }
  await chrome.storage.session.set({ [PENDING_INTENT_KEY]: intent });
}

export async function clearPendingIntent(): Promise<void> {
  await setPendingIntent(null);
}


export async function getAgentRun(): Promise<AgentRunState | null> {
  try {
    const result = await chrome.storage.session.get(AGENT_RUN_KEY);
    const run = result[AGENT_RUN_KEY] as AgentRunState | undefined;
    return run ?? null;
  } catch {
    return null;
  }
}

export async function setAgentRun(run: AgentRunState | null): Promise<void> {
  if (run === null) {
    try {
      await chrome.storage.session.remove(AGENT_RUN_KEY);
    } catch {
      // ignore
    }
    return;
  }
  await chrome.storage.session.set({ [AGENT_RUN_KEY]: run });
}

export async function clearAgentRun(): Promise<void> {
  await setAgentRun(null);
}

export async function recordApprovedProposal(proposalId: string): Promise<void> {
  const current = await getAgentRun();
  if (current) {
    current.approvedProposalId = proposalId;
    await setAgentRun(current);
  }
}

export async function getActionLogIndex(): Promise<string[]> {
  try {
    const result = await chrome.storage.local.get(ACTION_LOG_INDEX_KEY);
    const index = result[ACTION_LOG_INDEX_KEY];
    return Array.isArray(index) ? (index as string[]) : [];
  } catch {
    return [];
  }
}

export async function getActionLogSession(
  sessionId: string,
): Promise<ActionLogSession | null> {
  const key = `${ACTION_LOG_PREFIX}${sessionId}`;
  try {
    if (chrome.storage?.session) {
      const sessionRes = await chrome.storage.session.get(key);
      if (sessionRes && sessionRes[key]) {
        return sessionRes[key] as ActionLogSession;
      }
    }
  } catch {
    // fallback to local
  }

  try {
    if (chrome.storage?.local) {
      const localRes = await chrome.storage.local.get(key);
      if (localRes && localRes[key]) {
        return localRes[key] as ActionLogSession;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function appendActionLogEntry(
  sessionId: string,
  goal: string,
  entry: Omit<ActionLogEntry, "id" | "timestamp">,
  finalStatus?: AgentRunStatus,
): Promise<ActionLogSession> {
  const key = `${ACTION_LOG_PREFIX}${sessionId}`;
  const existing = await getActionLogSession(sessionId);
  const now = Date.now();

  const newEntry: ActionLogEntry = {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `entry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    stepIndex: entry.stepIndex,
    type: entry.type,
    target: entry.target,
    ...(entry.value !== undefined ? { value: entry.value } : {}),
    reason: entry.reason,
    decision: entry.decision,
    timestamp: now,
  };

  const updatedSession: ActionLogSession = existing ?? {
    sessionId,
    goal,
    startedAt: now,
    status: finalStatus ?? "waiting_approval",
    entries: [],
  };

  updatedSession.entries.push(newEntry);
  if (finalStatus) {
    updatedSession.status = finalStatus;
    if (
      finalStatus === "done" ||
      finalStatus === "stopped" ||
      finalStatus === "error"
    ) {
      updatedSession.endedAt = now;
    }
  }

  // Save session record to session storage and local storage
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.set({ [key]: updatedSession });
    }
  } catch {}
  try {
    if (chrome.storage?.local) {
      await chrome.storage.local.set({ [key]: updatedSession });
    }
  } catch {}

  // Update actionLogIndex in local storage (capped at LIMITS.actionLogSessions = 20)
  const currentIndex = await getActionLogIndex();
  let nextIndex = [sessionId, ...currentIndex.filter((id) => id !== sessionId)];

  if (nextIndex.length > LIMITS.actionLogSessions) {
    const evicted = nextIndex.slice(LIMITS.actionLogSessions);
    nextIndex = nextIndex.slice(0, LIMITS.actionLogSessions);

    // Evict old sessions past cap
    for (const evictedId of evicted) {
      const evictedKey = `${ACTION_LOG_PREFIX}${evictedId}`;
      try {
        if (chrome.storage?.session) {
          await chrome.storage.session.remove(evictedKey);
        }
      } catch {}
      try {
        if (chrome.storage?.local) {
          await chrome.storage.local.remove(evictedKey);
        }
      } catch {}
    }
  }

  try {
    if (chrome.storage?.local) {
      await chrome.storage.local.set({ [ACTION_LOG_INDEX_KEY]: nextIndex });
    }
  } catch {}

  return updatedSession;
}

export async function getAllActionLogs(): Promise<ActionLogSession[]> {
  const index = await getActionLogIndex();
  const sessions: ActionLogSession[] = [];
  for (const sessionId of index) {
    const s = await getActionLogSession(sessionId);
    if (s) {
      sessions.push(s);
    }
  }
  return sessions;
}

export async function clearActionLogs(): Promise<void> {
  const index = await getActionLogIndex();
  for (const sessionId of index) {
    const key = `${ACTION_LOG_PREFIX}${sessionId}`;
    try {
      if (chrome.storage?.session) {
        await chrome.storage.session.remove(key);
      }
    } catch {}
    try {
      if (chrome.storage?.local) {
        await chrome.storage.local.remove(key);
      }
    } catch {}
  }
  try {
    if (chrome.storage?.local) {
      await chrome.storage.local.remove(ACTION_LOG_INDEX_KEY);
    }
  } catch {}
}
