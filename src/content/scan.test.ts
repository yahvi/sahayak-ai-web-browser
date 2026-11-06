import { beforeEach, describe, expect, it } from "vitest";
import { clearOverlays, highlightElement, renderOverlays } from "./overlay";
import {
  clearRegistry,
  getElementByN,
  getElementRegistry,
  scanElements,
} from "./scan";

interface MockElementOptions {
  tagName: string;
  id?: string;
  className?: string;
  attributes?: Record<string, string>;
  textContent?: string;
  value?: string;
  type?: string;
  disabled?: boolean;
  checked?: boolean;
  options?: Array<{ text: string; selected?: boolean }>;
  rect?: { top?: number; left?: number; width?: number; height?: number };
  style?: Record<string, string>;
  parent?: any;
}

class FakeElement {
  tagName: string;
  id: string;
  className: string;
  attributes: Map<string, string>;
  textContent: string;
  innerText: string;
  value: string;
  type: string;
  disabled: boolean;
  checked: boolean;
  options: Array<{ text: string; selected: boolean }>;
  selectedIndex: number;
  rect: { top: number; left: number; width: number; height: number };
  style: Record<string, string>;
  parent: FakeElement | null;
  children: FakeElement[];
  scrollIntoViewCalled = false;

  constructor(opts: MockElementOptions) {
    this.tagName = opts.tagName.toUpperCase();
    this.id = opts.id ?? "";
    this.className = opts.className ?? "";
    this.attributes = new Map(Object.entries(opts.attributes ?? {}));
    this.textContent = opts.textContent ?? "";
    this.innerText = opts.textContent ?? "";
    this.value = opts.value ?? "";
    this.type = opts.type ?? "";
    this.disabled = opts.disabled ?? false;
    this.checked = opts.checked ?? false;
    this.options = (opts.options ?? []).map((o) => ({
      text: o.text,
      selected: Boolean(o.selected),
    }));
    this.selectedIndex = this.options.findIndex((o) => o.selected);
    if (this.selectedIndex === -1 && this.options.length > 0) {
      this.selectedIndex = 0;
    }
    this.rect = {
      top: opts.rect?.top ?? 10,
      left: opts.rect?.left ?? 10,
      width: opts.rect?.width ?? 100,
      height: opts.rect?.height ?? 30,
    };
    this.style = opts.style ?? {};
    this.parent = opts.parent ?? null;
    this.children = [];
  }

  getAttribute(name: string): string | null {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    if (name === "type") return this.type || null;
    if (name === "value") return this.value || null;
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    if (name === "id") this.id = value;
    else if (name === "class") this.className = value;
    else this.attributes.set(name, value);
  }

  hasAttribute(name: string): boolean {
    if (name === "disabled") return this.disabled;
    if (name === "id") return Boolean(this.id);
    if (name === "class") return Boolean(this.className);
    return this.attributes.has(name);
  }

  getBoundingClientRect() {
    return this.rect;
  }

  scrollIntoView() {
    this.scrollIntoViewCalled = true;
  }

  closest(selector: string): FakeElement | null {
    let curr: FakeElement | null = this;
    while (curr) {
      if (
        selector.includes("data-sahayak") &&
        curr.getAttribute("data-sahayak") === "true"
      ) {
        return curr;
      }
      if (
        selector.includes("sahayak-") &&
        (curr.className.includes("sahayak-") || curr.id.includes("sahayak-"))
      ) {
        return curr;
      }
      curr = curr.parent;
    }
    return null;
  }

  appendChild(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
  }

  remove() {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx !== -1) {
        this.parent.children.splice(idx, 1);
      }
    }
  }
}

class FakeDocument {
  body: FakeElement;
  allElements: FakeElement[] = [];

  constructor() {
    this.body = new FakeElement({ tagName: "body" });
  }

  addElement(opts: MockElementOptions): FakeElement {
    const el = new FakeElement(opts);
    this.body.appendChild(el);
    this.allElements.push(el);
    return el;
  }

  querySelectorAll<T = HTMLElement>(_selector: string): T[] {
    return this.allElements as unknown as T[];
  }

  querySelector<T = HTMLElement>(_selector: string): T | null {
    return null;
  }

  getElementById(id: string): FakeElement | null {
    const find = (el: FakeElement): FakeElement | null => {
      if (el.id === id) return el;
      for (const child of el.children) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    return find(this.body);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement({ tagName });
  }

  get defaultView() {
    return {
      scrollY: 0,
      scrollX: 0,
      getComputedStyle: (el: FakeElement) => ({
        display: el.style.display || "block",
        visibility: el.style.visibility || "visible",
        opacity: el.style.opacity || "1",
      }),
    };
  }
}

describe("scanElements", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("numbers one of each control type in fixture HTML", () => {
    const doc = new FakeDocument();

    doc.addElement({
      tagName: "button",
      textContent: "Submit Application",
      rect: { top: 10, left: 10, width: 120, height: 40 },
    });

    doc.addElement({
      tagName: "a",
      attributes: { href: "https://example.com/guide" },
      textContent: "Read Guide",
      rect: { top: 60, left: 10, width: 90, height: 20 },
    });

    doc.addElement({
      tagName: "input",
      type: "text",
      attributes: { placeholder: "Full Name" },
      value: "Aarav Gupta",
      rect: { top: 90, left: 10, width: 200, height: 30 },
    });

    doc.addElement({
      tagName: "input",
      type: "checkbox",
      attributes: { "aria-label": "Accept terms" },
      checked: true,
      rect: { top: 130, left: 10, width: 20, height: 20 },
    });

    doc.addElement({
      tagName: "select",
      attributes: { "aria-label": "College" },
      options: [
        { text: "Select college...", selected: false },
        { text: "IIT Delhi", selected: true },
      ],
      rect: { top: 160, left: 10, width: 180, height: 30 },
    });

    doc.addElement({
      tagName: "textarea",
      attributes: { placeholder: "Bio / SOP" },
      value: "Engineering student interested in AI.",
      rect: { top: 200, left: 10, width: 250, height: 60 },
    });

    doc.addElement({
      tagName: "div",
      attributes: { role: "button", "aria-label": "Custom button" },
      textContent: "Click me",
      rect: { top: 270, left: 10, width: 100, height: 30 },
    });

    const nodes = scanElements(doc as unknown as Document);

    expect(nodes).toHaveLength(7);
    expect(nodes[0]).toMatchObject({
      n: 1,
      role: "button",
      name: "Submit Application",
    });
    expect(nodes[1]).toMatchObject({
      n: 2,
      role: "link",
      name: "Read Guide",
    });
    expect(nodes[2]).toMatchObject({
      n: 3,
      role: "input",
      type: "text",
      name: "Full Name",
      valuePreview: "Aarav Gupta",
    });
    expect(nodes[3]).toMatchObject({
      n: 4,
      role: "checkbox",
      type: "checkbox",
      name: "Accept terms",
      valuePreview: "checked",
    });
    expect(nodes[4]).toMatchObject({
      n: 5,
      role: "select",
      name: "College",
      valuePreview: "IIT Delhi",
    });
    expect(nodes[5]).toMatchObject({
      n: 6,
      role: "textarea",
      name: "Bio / SOP",
      valuePreview: "Engineering student interested",
    });
    expect(nodes[6]).toMatchObject({
      n: 7,
      role: "button",
      name: "Custom button",
    });
  });

  it("marks type=password as protected and includes NO valuePreview", () => {
    const doc = new FakeDocument();

    doc.addElement({
      tagName: "input",
      type: "password",
      id: "user-password",
      attributes: { placeholder: "Enter password" },
      value: "SuperSecret123!",
      rect: { top: 10, left: 10, width: 150, height: 30 },
    });

    const nodes = scanElements(doc as unknown as Document);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].n).toBe(1);
    expect(nodes[0].type).toBe("password");
    expect(nodes[0].protected).toBe(true);
    expect(nodes[0].valuePreview).toBeUndefined();
  });

  it("marks OTP and card fields as protected with NO valuePreview", () => {
    const doc = new FakeDocument();

    doc.addElement({
      tagName: "input",
      type: "text",
      attributes: { autocomplete: "one-time-code" },
      value: "123456",
      rect: { top: 10, left: 10, width: 100, height: 30 },
    });

    doc.addElement({
      tagName: "input",
      type: "text",
      attributes: { autocomplete: "cc-number" },
      value: "4111222233334444",
      rect: { top: 50, left: 10, width: 180, height: 30 },
    });

    const nodes = scanElements(doc as unknown as Document);

    expect(nodes).toHaveLength(2);
    expect(nodes[0].protected).toBe(true);
    expect(nodes[0].valuePreview).toBeUndefined();
    expect(nodes[1].protected).toBe(true);
    expect(nodes[1].valuePreview).toBeUndefined();
  });

  it("does NOT count overlay nodes with Sahayak prefix as interactive elements", () => {
    const doc = new FakeDocument();

    // Normal interactive button
    doc.addElement({
      tagName: "button",
      textContent: "Normal Page Button",
      rect: { top: 10, left: 10, width: 100, height: 30 },
    });

    // Sahayak overlay badge node
    doc.addElement({
      tagName: "div",
      className: "sahayak-element-badge",
      attributes: { "data-sahayak": "true", role: "button" },
      textContent: "1",
      rect: { top: 10, left: 10, width: 20, height: 20 },
    });

    // Sahayak overlay container
    const container = doc.addElement({
      tagName: "div",
      id: "sahayak-overlay-container",
      attributes: { "data-sahayak": "true" },
    });

    // Child button inside sahayak container
    const childBadge = new FakeElement({
      tagName: "button",
      textContent: "Dismiss",
      parent: container,
    });
    doc.allElements.push(childBadge);

    const nodes = scanElements(doc as unknown as Document);

    // Only the normal page button is counted!
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("Normal Page Button");
  });

  it("skips hidden, disabled, and zero-size controls", () => {
    const doc = new FakeDocument();

    // 1. Visible button
    doc.addElement({
      tagName: "button",
      textContent: "Visible Button",
      rect: { top: 10, left: 10, width: 100, height: 30 },
    });

    // 2. Disabled button
    doc.addElement({
      tagName: "button",
      disabled: true,
      textContent: "Disabled Button",
      rect: { top: 50, left: 10, width: 100, height: 30 },
    });

    // 3. aria-disabled
    doc.addElement({
      tagName: "div",
      attributes: { role: "button", "aria-disabled": "true" },
      textContent: "Aria Disabled",
      rect: { top: 90, left: 10, width: 100, height: 30 },
    });

    // 4. aria-hidden
    doc.addElement({
      tagName: "button",
      attributes: { "aria-hidden": "true" },
      textContent: "Aria Hidden",
      rect: { top: 130, left: 10, width: 100, height: 30 },
    });

    // 5. display: none
    doc.addElement({
      tagName: "button",
      style: { display: "none" },
      textContent: "Display None",
      rect: { top: 170, left: 10, width: 100, height: 30 },
    });

    // 6. visibility: hidden
    doc.addElement({
      tagName: "button",
      style: { visibility: "hidden" },
      textContent: "Visibility Hidden",
      rect: { top: 210, left: 10, width: 100, height: 30 },
    });

    // 7. Zero size (width: 0, height: 0)
    doc.addElement({
      tagName: "button",
      textContent: "Zero Size",
      rect: { top: 250, left: 10, width: 0, height: 0 },
    });

    const nodes = scanElements(doc as unknown as Document);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("Visible Button");
  });

  it("sorts elements in visual top-to-bottom order", () => {
    const doc = new FakeDocument();

    doc.addElement({
      tagName: "button",
      textContent: "Bottom Button",
      rect: { top: 300, left: 10, width: 100, height: 30 },
    });

    doc.addElement({
      tagName: "button",
      textContent: "Top Button",
      rect: { top: 20, left: 10, width: 100, height: 30 },
    });

    doc.addElement({
      tagName: "button",
      textContent: "Middle Button",
      rect: { top: 150, left: 10, width: 100, height: 30 },
    });

    const nodes = scanElements(doc as unknown as Document);

    expect(nodes).toHaveLength(3);
    expect(nodes[0].name).toBe("Top Button");
    expect(nodes[1].name).toBe("Middle Button");
    expect(nodes[2].name).toBe("Bottom Button");
  });
});

describe("overlay functions", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("renderOverlays creates badges for registered elements", () => {
    const doc = new FakeDocument();

    doc.addElement({
      tagName: "button",
      textContent: "Action 1",
      rect: { top: 20, left: 20, width: 100, height: 30 },
    });

    doc.addElement({
      tagName: "button",
      textContent: "Action 2",
      rect: { top: 80, left: 20, width: 100, height: 30 },
    });

    scanElements(doc as unknown as Document);
    renderOverlays(doc as unknown as Document);

    const container = doc.getElementById("sahayak-overlay-container");
    expect(container).not.toBeNull();
    expect(container?.getAttribute("data-sahayak")).toBe("true");
    expect(container?.children).toHaveLength(2);
    expect(container?.children[0].textContent).toBe("1");
    expect(container?.children[1].textContent).toBe("2");
  });

  it("highlightElement outlines element and scrolls into view without clicking", () => {
    const doc = new FakeDocument();

    const btn = doc.addElement({
      tagName: "button",
      textContent: "Target Action",
      rect: { top: 20, left: 20, width: 100, height: 30 },
    });

    scanElements(doc as unknown as Document);

    const success = highlightElement(1);
    expect(success).toBe(true);
    expect(btn.scrollIntoViewCalled).toBe(true);
    expect(btn.style.outline).toContain("#0f766e");

    // Highlighting invalid n returns false
    expect(highlightElement(999)).toBe(false);
  });

  it("clearOverlays removes container and restores outline", () => {
    const doc = new FakeDocument();

    const btn = doc.addElement({
      tagName: "button",
      textContent: "Target Action",
      rect: { top: 20, left: 20, width: 100, height: 30 },
    });

    scanElements(doc as unknown as Document);
    renderOverlays(doc as unknown as Document);
    highlightElement(1);

    expect(doc.getElementById("sahayak-overlay-container")).not.toBeNull();
    expect(btn.style.outline).toContain("#0f766e");

    clearOverlays(doc as unknown as Document);

    expect(doc.getElementById("sahayak-overlay-container")).toBeNull();
    expect(btn.style.outline).toBe("");
  });
});

