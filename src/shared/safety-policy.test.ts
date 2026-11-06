import { describe, expect, it } from "vitest";
import {
  classifyField,
  classifyUrl,
  isConsequentialName,
} from "./safety-policy";

describe("classifyUrl", () => {
  it("marks a bank host as sensitive", () => {
    expect(classifyUrl("https://www.hdfcbank.com/login")).toBe("sensitive");
    expect(classifyUrl("https://netbanking.example.com/")).toBe("sensitive");
  });

  it("marks /checkout paths as sensitive", () => {
    expect(classifyUrl("https://shop.example.com/checkout")).toBe("sensitive");
    expect(classifyUrl("https://shop.example.com/checkout/review")).toBe(
      "sensitive",
    );
  });

  it("marks localhost practice pages as allowlisted", () => {
    expect(classifyUrl("http://127.0.0.1:4173/apply.html")).toBe("allowlisted");
    expect(classifyUrl("http://localhost:5173/shop.html")).toBe("allowlisted");
  });

  it("marks a normal news URL as normal", () => {
    expect(
      classifyUrl("https://www.bbc.com/news/world-asia-12345678"),
    ).toBe("normal");
  });

  it("keeps a bank host sensitive even when added to a user allowlist (Allowlist + bank host -> still sensitive)", () => {
    expect(
      classifyUrl("https://paypal.com/home", ["paypal.com", "127.0.0.1"]),
    ).toBe("sensitive");
    expect(
      classifyUrl("https://www.hdfcbank.com/portal", [
        "hdfcbank.com",
        "localhost",
      ]),
    ).toBe("sensitive");
    expect(
      classifyUrl("https://icicibank.com/personal", ["icicibank.com"]),
    ).toBe("sensitive");
  });

  it("treats unparseable URLs as sensitive", () => {
    expect(classifyUrl("not-a-url")).toBe("sensitive");
  });
});

describe("classifyField", () => {
  it("detects password fields", () => {
    expect(classifyField({ type: "password" })).toBe("password");
    expect(
      classifyField({ type: "password", name: "user_password", id: "pwd" }),
    ).toBe("password");
  });

  it("detects OTP via autocomplete and name fixtures (OTP fixtures still protected)", () => {
    expect(classifyField({ autocomplete: "one-time-code" })).toBe("otp");
    expect(classifyField({ type: "text", name: "otp" })).toBe("otp");
    expect(
      classifyField({ type: "text", name: "user_otp", id: "otp-input" }),
    ).toBe("otp");
    expect(classifyField({ type: "tel", name: "totp" })).toBe("otp");
  });

  it("detects card number via autocomplete, name, and id fixtures (Card fixtures still protected)", () => {
    expect(classifyField({ autocomplete: "cc-number" })).toBe("card");
    expect(classifyField({ type: "text", name: "creditCardNumber" })).toBe(
      "card",
    );
    expect(classifyField({ type: "text", name: "card_cvv", id: "cvc" })).toBe(
      "card",
    );
    expect(classifyField({ autocomplete: "cc-csc" })).toBe("card");
  });

  it("treats a plain text input as normal", () => {
    expect(classifyField({ type: "text", name: "fullName" })).toBe("normal");
    expect(classifyField({ type: "email", name: "user_email" })).toBe("normal");
  });
});

describe("isConsequentialName", () => {
  it("flags Submit, Pay, and Send", () => {
    expect(isConsequentialName("Submit")).toBe(true);
    expect(isConsequentialName("Pay now")).toBe(true);
    expect(isConsequentialName("Send")).toBe(true);
  });

  it("flags http://127.0.0.1 Apply errand Submit button text as consequential", () => {
    // Slice 16: http://127.0.0.1 Apply Submit button -> isConsequentialName true
    expect(isConsequentialName("Submit Application")).toBe(true);
    expect(isConsequentialName("Submit Form")).toBe(true);
    expect(isConsequentialName("Place Order")).toBe(true);
    expect(isConsequentialName("Confirm Payment")).toBe(true);
    expect(isConsequentialName("Pay ₹500")).toBe(true);
    expect(isConsequentialName("Send Application")).toBe(true);
  });

  it("does not flag harmless buttons like Next or Save", () => {
    expect(isConsequentialName("Next")).toBe(false);
    expect(isConsequentialName("Save Draft")).toBe(false);
    expect(isConsequentialName("Cancel")).toBe(false);
  });
});
