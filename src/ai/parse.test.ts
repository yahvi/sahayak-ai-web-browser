import { describe, expect, it } from "vitest";
import { parseAgentStep, parseFindIt, parseSummary } from "./parse";

describe("parseSummary", () => {
  it("accepts a valid summary JSON object", () => {
    const raw = JSON.stringify({
      tldr: "This article explains how Chrome extensions work under Manifest V3.",
      points: [
        "Extensions use background service workers instead of background pages.",
        "The side panel API offers persistent assistant UI.",
        "Content scripts execute in isolated DOM worlds.",
        "Storage is split into local, sync, and session areas.",
        "User approval prevents unauthorized browser actions.",
      ],
      next: "Inspect chrome://extensions to load your unpacked extension.",
    });

    const result = parseSummary(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tldr).toBe(
        "This article explains how Chrome extensions work under Manifest V3.",
      );
      expect(result.data.points).toHaveLength(5);
      expect(result.data.next).toBe(
        "Inspect chrome://extensions to load your unpacked extension.",
      );
      expect(result.data.chapters).toBeUndefined();
    }
  });

  it("does not include chapters for a non-YouTube article summary", () => {
    const raw = JSON.stringify({
      tldr: "News article about climate summit",
      points: ["P1", "P2", "P3", "P4", "P5"],
      next: "Follow the resolutions",
    });
    const result = parseSummary(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.chapters).toBeUndefined();
    }
  });

  it("rejects missing or empty tldr", () => {
    const missingTldr = JSON.stringify({
      points: ["Point 1", "Point 2"],
      next: "Do something",
    });
    const res1 = parseSummary(missingTldr);
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      expect(resultIsInvalid(res1.error.code)).toBe(true);
    }

    const emptyTldr = JSON.stringify({
      tldr: "   ",
      points: ["Point 1"],
      next: "Do something",
    });
    const res2 = parseSummary(emptyTldr);
    expect(res2.ok).toBe(false);
  });

  it("caps points at five if the model returns more than five", () => {
    const raw = JSON.stringify({
      tldr: "Summary of multiple items",
      points: [
        "Point 1",
        "Point 2",
        "Point 3",
        "Point 4",
        "Point 5",
        "Point 6",
        "Point 7",
        "Point 8",
      ],
      next: "Next step",
    });

    const result = parseSummary(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.points).toHaveLength(5);
      expect(result.data.points[0]).toBe("Point 1");
      expect(result.data.points[4]).toBe("Point 5");
    }
  });

  it("rejects empty or non-array points", () => {
    const emptyPoints = JSON.stringify({
      tldr: "Valid tldr",
      points: [],
      next: "Next step",
    });
    expect(parseSummary(emptyPoints).ok).toBe(false);

    const nonArrayPoints = JSON.stringify({
      tldr: "Valid tldr",
      points: "not an array",
      next: "Next step",
    });
    expect(parseSummary(nonArrayPoints).ok).toBe(false);
  });

  it("strips markdown code blocks and surrounding conversational text", () => {
    const wrapped = `
Here is the structured summary you requested:
\`\`\`json
{
  "tldr": "Article TLDR",
  "points": ["Key point 1", "Key point 2", "Key point 3"],
  "next": "Read more"
}
\`\`\`
I hope this was helpful!
    `;

    const result = parseSummary(wrapped);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tldr).toBe("Article TLDR");
      expect(result.data.points).toHaveLength(3);
    }
  });

  it("rejects malformed JSON", () => {
    const malformed = "{ tldr: invalid json without quotes ";
    const result = parseSummary(malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_model_output");
    }
  });

  it("parses optional chapters when present for YouTube summary", () => {
    const raw = JSON.stringify({
      tldr: "Video explanation",
      points: ["P1", "P2"],
      next: "Next",
      chapters: [
        { timestamp: "01:23", note: "Introduction" },
        { timestamp: "04:56", note: "Core Concepts" },
      ],
    });

    const result = parseSummary(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.chapters).toBeDefined();
      expect(result.data.chapters).toHaveLength(2);
      expect(result.data.chapters?.[0].timestamp).toBe("01:23");
    }
  });
});

function resultIsInvalid(code: string): boolean {
  return code === "invalid_model_output";
}


describe("parseFindIt", () => {
  const currentMap = [1, 2, 3, 4, 5];

  it("accepts valid { element: 3, reason: '...' }", () => {
    const raw = JSON.stringify({
      element: 3,
      reason: "This is the resume file upload input.",
    });

    const res = parseFindIt(raw, currentMap);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.element).toBe(3);
      expect(res.data.reason).toBe("This is the resume file upload input.");
    }
  });

  it("accepts valid JSON enclosed in markdown code fences or conversational text", () => {
    const raw = `
I located the element for you:
\`\`\`json
{
  "element": 2,
  "reason": "Submit Application button at the bottom of the form."
}
\`\`\`
Hope this helps!
    `;

    const res = parseFindIt(raw, currentMap);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.element).toBe(2);
      expect(res.data.reason).toBe(
        "Submit Application button at the bottom of the form.",
      );
    }
  });

  it("accepts declined shape { element: null, reason: '...' } when element is not on page", () => {
    const raw = JSON.stringify({
      element: null,
      reason: "There is no login button on this page.",
    });

    const res = parseFindIt(raw, currentMap);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.element).toBeNull();
      expect(res.data.reason).toBe("There is no login button on this page.");
    }
  });

  it("rejects missing element field", () => {
    const raw = JSON.stringify({
      reason: "Only a reason without an element number",
    });

    const res = parseFindIt(raw, currentMap);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("invalid_model_output");
    }
  });

  it("rejects non-integer element (string, float, boolean)", () => {
    const stringElement = JSON.stringify({
      element: "three",
      reason: "Element three",
    });
    expect(parseFindIt(stringElement, currentMap).ok).toBe(false);

    const floatElement = JSON.stringify({
      element: 3.14,
      reason: "Float element",
    });
    expect(parseFindIt(floatElement, currentMap).ok).toBe(false);

    const boolElement = JSON.stringify({
      element: true,
      reason: "Boolean element",
    });
    expect(parseFindIt(boolElement, currentMap).ok).toBe(false);
  });

  it("rejects element not present on current map", () => {
    const raw = JSON.stringify({
      element: 99,
      reason: "Element 99 is not on the map",
    });

    const res = parseFindIt(raw, currentMap);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("invalid_model_output");
    }
  });

  it("rejects malformed raw JSON string", () => {
    const raw = "{ element: 1, reason: unquoted text }";
    const res = parseFindIt(raw, currentMap);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("invalid_model_output");
    }
  });
});


describe("parseAgentStep", () => {
  const currentMap = [1, 2, 3, 4, 5];

  it("accepts click with element and reason", () => {
    const raw = JSON.stringify({
      type: "click",
      element: 2,
      reason: "Click the Submit Application button.",
    });

    const res = parseAgentStep(raw, currentMap);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.type).toBe("click");
      expect(res.data.element).toBe(2);
      expect(res.data.reason).toBe("Click the Submit Application button.");
    }
  });

  it("accepts type with element, value, and reason", () => {
    const raw = JSON.stringify({
      type: "type",
      element: 3,
      value: "Aarav Sharma",
      reason: "Type the full name into the applicant name input.",
    });

    const res = parseAgentStep(raw, currentMap);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.type).toBe("type");
      expect(res.data.element).toBe(3);
      expect(res.data.value).toBe("Aarav Sharma");
      expect(res.data.reason).toBe(
        "Type the full name into the applicant name input.",
      );
    }
  });

  it("accepts select with element, value, and reason", () => {
    const raw = JSON.stringify({
      type: "select",
      element: 4,
      value: "iit_delhi",
      reason: "Select IIT Delhi from the college dropdown.",
    });

    const res = parseAgentStep(raw, currentMap);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.type).toBe("select");
      expect(res.data.element).toBe(4);
      expect(res.data.value).toBe("iit_delhi");
      expect(res.data.reason).toBe(
        "Select IIT Delhi from the college dropdown.",
      );
    }
  });

  it("accepts done without element", () => {
    const raw = JSON.stringify({
      type: "done",
      reason: "All application fields have been filled and submitted.",
    });

    const res = parseAgentStep(raw, currentMap);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.type).toBe("done");
      expect(res.data.element).toBeUndefined();
      expect(res.data.reason).toBe(
        "All application fields have been filled and submitted.",
      );
    }
  });

  it("rejects unknown action type", () => {
    const raw = JSON.stringify({
      type: "hover",
      element: 1,
      reason: "Hover over the menu item",
    });

    const res = parseAgentStep(raw, currentMap);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("invalid_model_output");
    }
  });

  it("rejects missing or empty reason", () => {
    const missingReason = JSON.stringify({
      type: "click",
      element: 1,
    });
    expect(parseAgentStep(missingReason, currentMap).ok).toBe(false);

    const emptyReason = JSON.stringify({
      type: "click",
      element: 1,
      reason: "   ",
    });
    expect(parseAgentStep(emptyReason, currentMap).ok).toBe(false);
  });

  it("rejects click without element or with non-integer element", () => {
    const missingElement = JSON.stringify({
      type: "click",
      reason: "Click somewhere",
    });
    expect(parseAgentStep(missingElement, currentMap).ok).toBe(false);

    const stringElement = JSON.stringify({
      type: "click",
      element: "two",
      reason: "Click element two",
    });
    expect(parseAgentStep(stringElement, currentMap).ok).toBe(false);
  });

  it("rejects type without value", () => {
    const missingValue = JSON.stringify({
      type: "type",
      element: 2,
      reason: "Type into the input",
    });

    const res = parseAgentStep(missingValue, currentMap);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("invalid_model_output");
    }
  });

  it("rejects element not on current map", () => {
    const raw = JSON.stringify({
      type: "click",
      element: 88,
      reason: "Click out-of-bounds element",
    });

    const res = parseAgentStep(raw, currentMap);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("invalid_model_output");
    }
  });
});
