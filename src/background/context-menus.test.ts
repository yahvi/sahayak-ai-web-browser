import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../shared/limits";
import type { PendingIntent } from "../shared/protocol";
import {
  CONTEXT_MENU_IDS,
  handleContextMenuClick,
  registerContextMenus,
} from "./context-menus";

describe("context-menus", () => {
  const sessionStore: Record<string, unknown> = {};

  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "mock-uuid-1234",
    });

    vi.stubGlobal("chrome", {
      contextMenus: {
        removeAll: vi.fn((cb?: () => void) => cb?.()),
        create: vi.fn(),
        onClicked: {
          addListener: vi.fn(),
        },
      },
      sidePanel: {
        open: vi.fn().mockResolvedValue(undefined),
      },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionStore[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(sessionStore, items);
          }),
          remove: vi.fn(async (key: string) => {
            delete sessionStore[key];
          }),
        },
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of Object.keys(sessionStore)) {
      delete sessionStore[k];
    }
  });

  it("registers three context menus with selection context", () => {
    registerContextMenus();

    expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(3);

    const calls = vi.mocked(chrome.contextMenus.create).mock.calls;
    const menuIds = calls.map((c) => (c[0] as { id: string }).id);
    expect(menuIds).toEqual([
      CONTEXT_MENU_IDS.explain,
      CONTEXT_MENU_IDS.translate,
      CONTEXT_MENU_IDS.draft,
    ]);
  });

  it("handles explain menu click by saving pendingIntent and opening sidePanel", async () => {
    const info = {
      menuItemId: CONTEXT_MENU_IDS.explain,
      selectionText: "  Quantum superposition  ",
    } as chrome.contextMenus.OnClickData;

    const tab = {
      id: 42,
      url: "https://en.wikipedia.org/wiki/Quantum_superposition",
      windowId: 1,
    } as chrome.tabs.Tab;

    await handleContextMenuClick(info, tab);

    const saved = sessionStore.pendingIntent as PendingIntent;
    expect(saved).toBeDefined();
    expect(saved.kind).toBe("explain");
    expect(saved.selectionText).toBe("Quantum superposition");
    expect(saved.tabId).toBe(42);
    expect(saved.url).toBe("https://en.wikipedia.org/wiki/Quantum_superposition");
    expect(typeof saved.createdAt).toBe("number");

    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 });
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
  });

  it("caps selection text at 4,000 characters", async () => {
    const hugeText = "x".repeat(6000);
    const info = {
      menuItemId: CONTEXT_MENU_IDS.translate,
      selectionText: hugeText,
    } as chrome.contextMenus.OnClickData;

    const tab = { id: 10, url: "https://example.com" } as chrome.tabs.Tab;

    await handleContextMenuClick(info, tab);

    const saved = sessionStore.pendingIntent as PendingIntent;
    expect(saved.kind).toBe("translate");
    expect(saved.selectionText).toHaveLength(LIMITS.selectionChars);
    expect(saved.selectionText).toBe("x".repeat(4000));
  });

  it("ignores clicks with empty selection text without saving intent", async () => {
    const info = {
      menuItemId: CONTEXT_MENU_IDS.draft,
      selectionText: "   ",
    } as chrome.contextMenus.OnClickData;

    const tab = { id: 10, url: "https://example.com" } as chrome.tabs.Tab;

    await handleContextMenuClick(info, tab);

    expect(sessionStore.pendingIntent).toBeUndefined();
    expect(chrome.sidePanel.open).not.toHaveBeenCalled();
  });
});

