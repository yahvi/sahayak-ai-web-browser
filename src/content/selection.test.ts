import { describe, expect, it } from "vitest";
import { LIMITS } from "../shared/limits";
import { getPageSelection } from "./selection";

describe("getPageSelection", () => {
  it("returns empty string when there is no text selected", () => {
    const fakeDoc = {
      defaultView: {
        getSelection: () => ({
          toString: () => "",
        }),
      },
    } as unknown as Document;

    expect(getPageSelection(fakeDoc)).toBe("");
  });

  it("trims whitespace from the selected text", () => {
    const fakeDoc = {
      defaultView: {
        getSelection: () => ({
          toString: () => "   Hello selected world!   \n\t",
        }),
      },
    } as unknown as Document;

    expect(getPageSelection(fakeDoc)).toBe("Hello selected world!");
  });

  it("caps selection at LIMITS.selectionChars (4000 characters)", () => {
    const hugeString = "a".repeat(5000);
    const fakeDoc = {
      defaultView: {
        getSelection: () => ({
          toString: () => hugeString,
        }),
      },
    } as unknown as Document;

    const result = getPageSelection(fakeDoc);
    expect(result).toHaveLength(LIMITS.selectionChars);
    expect(result).toBe("a".repeat(4000));
  });

  it("handles exception in getSelection gracefully without throwing", () => {
    const fakeDoc = {
      defaultView: {
        getSelection: () => {
          throw new Error("Selection permission denied");
        },
      },
    } as unknown as Document;

    expect(getPageSelection(fakeDoc)).toBe("");
  });
});

