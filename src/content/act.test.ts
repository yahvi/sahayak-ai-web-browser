import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeAct } from "./act";
import { clearRegistry, getElementRegistry } from "./scan";

class MockActElement {
  tagName: string;
  id: string;
  className: string;
  type: string;
  name: string;
  value: string;
  textContent: string;
  innerText: string;
  attributes: Map<string, string>;
  options: Array<{ value: string; text: string; selected: boolean }>;
  selectedIndex = 0;
  clickCalled = false;
  focusCalled = false;
  scrollIntoViewCalled = false;
  dispatchedEvents: string[] = [];

  constructor(opts: {
    tagName: string;
    id?: string;
    type?: string;
    name?: string;
    value?: string;
    textContent?: string;
    attributes?: Record<string, string>;
    options?: Array<{ value: string; text: string }>;
  }) {
    this.tagName = opts.tagName.toUpperCase();
    this.id = opts.id ?? "";
    this.type = opts.type ?? "";
    this.name = opts.name ?? "";
    this.value = opts.value ?? "";
    this.textContent = opts.textContent ?? "";
    this.innerText = opts.textContent ?? "";
    this.attributes = new Map(Object.entries(opts.attributes ?? {}));
    this.className = "";
    this.options = (opts.options ?? []).map((o, idx) => ({
      value: o.value,
      text: o.text,
      selected: idx === 0,
    }));
  }

  getAttribute(name: string): string | null {
    if (name === "type") return this.type || null;
    if (name === "name") return this.name || null;
    if (name === "id") return this.id || null;
    return this.attributes.get(name) ?? null;
  }

  click() {
    this.clickCalled = true;
  }

  focus() {
    this.focusCalled = true;
  }

  scrollIntoView() {
    this.scrollIntoViewCalled = true;
  }

  dispatchEvent(event: { type: string }) {
    this.dispatchedEvents.push(event.type);
    return true;
  }
}

describe("executeAct", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("never executes a type action on a password field (protected_field)", () => {
    const passwordEl = new MockActElement({
      tagName: "input",
      type: "password",
      name: "pwd",
      id: "user-password",
      value: "",
    });

    const registry = getElementRegistry();
    registry.set(1, passwordEl as unknown as HTMLElement);

    const result = executeAct({
      proposalId: "p1",
      runId: "r1",
      stepIndex: 0,
      n: 1,
      type: "type",
      value: "hackedPassword123",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("protected_field");
    }
    // Value remains untouched
    expect(passwordEl.value).toBe("");
  });

  it("never executes a type action on an OTP or card field", () => {
    const otpEl = new MockActElement({
      tagName: "input",
      type: "text",
      attributes: { autocomplete: "one-time-code" },
      value: "",
    });

    const cardEl = new MockActElement({
      tagName: "input",
      type: "text",
      attributes: { autocomplete: "cc-number" },
      value: "",
    });

    const registry = getElementRegistry();
    registry.set(1, otpEl as unknown as HTMLElement);
    registry.set(2, cardEl as unknown as HTMLElement);

    const resOtp = executeAct({
      n: 1,
      type: "type",
      value: "123456",
    });
    expect(resOtp.ok).toBe(false);
    if (!resOtp.ok) {
      expect(resOtp.error.code).toBe("protected_field");
    }

    const resCard = executeAct({
      n: 2,
      type: "type",
      value: "4111222233334444",
    });
    expect(resCard.ok).toBe(false);
    if (!resCard.ok) {
      expect(resCard.error.code).toBe("protected_field");
    }
  });

  it("requires extra confirmation for consequential action names (needs_extra_confirm)", () => {
    const submitBtn = new MockActElement({
      tagName: "button",
      textContent: "Submit Application",
    });

    const registry = getElementRegistry();
    registry.set(1, submitBtn as unknown as HTMLElement);

    // 1. Without confirmedConsequential -> returns needs_extra_confirm
    const unconfirmedRes = executeAct({
      n: 1,
      type: "click",
      confirmedConsequential: false,
    });

    expect(unconfirmedRes.ok).toBe(false);
    if (!unconfirmedRes.ok) {
      expect(unconfirmedRes.error.code).toBe("needs_extra_confirm");
    }
    expect(submitBtn.clickCalled).toBe(false);

    // 2. With confirmedConsequential: true -> executes successfully
    const confirmedRes = executeAct({
      n: 1,
      type: "click",
      confirmedConsequential: true,
    });

    expect(confirmedRes.ok).toBe(true);
    expect(submitBtn.clickCalled).toBe(true);
  });

  it("executes valid click action on element n", () => {
    const btn = new MockActElement({
      tagName: "button",
      textContent: "Next Step",
    });

    const registry = getElementRegistry();
    registry.set(1, btn as unknown as HTMLElement);

    const result = executeAct({
      n: 1,
      type: "click",
    });

    expect(result.ok).toBe(true);
    expect(btn.clickCalled).toBe(true);
    expect(btn.scrollIntoViewCalled).toBe(true);
  });

  it("executes valid type action and dispatches input/change events", () => {
    const input = new MockActElement({
      tagName: "input",
      type: "text",
      name: "applicantName",
      value: "",
    });

    const registry = getElementRegistry();
    registry.set(2, input as unknown as HTMLElement);

    const result = executeAct({
      n: 2,
      type: "type",
      value: "Priya Sharma",
    });

    expect(result.ok).toBe(true);
    expect(input.value).toBe("Priya Sharma");
    expect(input.focusCalled).toBe(true);
    expect(input.dispatchedEvents).toContain("input");
    expect(input.dispatchedEvents).toContain("change");
  });

  it("executes valid select action on dropdown element", () => {
    const select = new MockActElement({
      tagName: "select",
      name: "college",
      options: [
        { value: "iit_delhi", text: "IIT Delhi" },
        { value: "bits_pilani", text: "BITS Pilani" },
      ],
    });

    const registry = getElementRegistry();
    registry.set(3, select as unknown as HTMLElement);

    const result = executeAct({
      n: 3,
      type: "select",
      value: "bits_pilani",
    });

    expect(result.ok).toBe(true);
    expect(select.selectedIndex).toBe(1);
    expect(select.dispatchedEvents).toContain("change");
  });

  it("executes done action without error or DOM element lookup", () => {
    const fakeDoc = {
      getElementById: vi.fn().mockReturnValue(null),
    } as unknown as Document;

    const result = executeAct(
      {
        type: "done",
      },
      fakeDoc,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.type).toBe("done");
      expect(result.data.executed).toBe(true);
    }
  });

  it("returns generic error if element n is not found on page", () => {
    const result = executeAct({
      n: 999,
      type: "click",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("generic");
      expect(result.error.message).toContain("Element [999] not found");
    }
  });
});

