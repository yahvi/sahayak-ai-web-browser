import { describe, expect, it } from "vitest";
import { buildPrompt, type ChatTurn } from "./prompts";

describe("buildPrompt", () => {
  it("assembles prompt in the strict 7-section order from architecture §9.5", () => {
    const prompt = buildPrompt({
      task: "chat",
      language: "en",
      page: "The quick brown fox jumps over the lazy dog.",
      profile: { name: "Alice", role: "Student" },
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
      ],
      userText: "What animal jumped?",
    });

    const systemIdx = prompt.indexOf("SYSTEM ROLE:");
    const safetyIdx = prompt.indexOf("SAFETY INVARIANTS:");
    const langIdx = prompt.indexOf("LANGUAGE INSTRUCTION:");
    const pageIdx = prompt.indexOf("PAGE CONTEXT:");
    const profileIdx = prompt.indexOf("USER PROFILE:");
    const histIdx = prompt.indexOf("CONVERSATION HISTORY:");
    const userIdx = prompt.indexOf("USER QUERY:");

    expect(systemIdx).toBeGreaterThanOrEqual(0);
    expect(safetyIdx).toBeGreaterThan(systemIdx);
    expect(langIdx).toBeGreaterThan(safetyIdx);
    expect(pageIdx).toBeGreaterThan(langIdx);
    expect(profileIdx).toBeGreaterThan(pageIdx);
    expect(histIdx).toBeGreaterThan(profileIdx);
    expect(userIdx).toBeGreaterThan(histIdx);
  });

  it("instructs Hinglish when language is set to hinglish", () => {
    const prompt = buildPrompt({
      task: "free_ask",
      language: "hinglish",
      userText: "Kaise ho?",
    });

    expect(prompt).toContain("Hinglish");
    expect(prompt).toContain("Roman script");
  });

  it("instructs English by default or when language is en", () => {
    const prompt = buildPrompt({
      task: "summary",
      language: "en",
      userText: "Summarise this",
    });

    expect(prompt).toContain("LANGUAGE INSTRUCTION: Respond in clear, concise English.");
  });

  it("includes chapter schema instructions for youtube_summary", () => {
    const prompt = buildPrompt({
      task: "youtube_summary",
      language: "hinglish",
      userText: "Summarise this video",
    });

    expect(prompt).toContain('"chapters"');
    expect(prompt).toContain("timestamp");
    expect(prompt).toContain("Hinglish");
    expect(prompt).toContain("Video media provided directly");
  });

  it("handles missing page context gracefully", () => {
    const prompt = buildPrompt({
      task: "free_ask",
      userText: "General knowledge question",
    });

    expect(prompt).toContain("PAGE CONTEXT: No page context provided.");
  });

  it("omits profile section when profile is null or empty", () => {
    const promptNull = buildPrompt({
      task: "free_ask",
      profile: null,
      userText: "Question",
    });
    expect(promptNull).not.toContain("USER PROFILE:");

    const promptEmpty = buildPrompt({
      task: "free_ask",
      profile: {},
      userText: "Question",
    });
    expect(promptEmpty).not.toContain("USER PROFILE:");
  });

  it("caps conversation history at the last 8 turns", () => {
    const turns: ChatTurn[] = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    }));

    const prompt = buildPrompt({
      task: "chat",
      history: turns,
      userText: "Final question",
    });

    // Should contain the last 8 turns (turns 7 to 14)
    expect(prompt).toContain("Message 7");
    expect(prompt).toContain("Message 14");
    // Should NOT contain earlier turns
    expect(prompt).not.toContain("Message 0");
    expect(prompt).not.toContain("Message 6");
  });

  it("omits history on summary tasks", () => {
    const prompt = buildPrompt({
      task: "summary",
      history: [{ role: "user", content: "Prior message" }],
      userText: "Summarise this",
    });

    expect(prompt).not.toContain("CONVERSATION HISTORY:");
  });

  it("includes safety invariants against passwords and OTPs", () => {
    const prompt = buildPrompt({
      task: "free_ask",
      userText: "Test",
    });

    expect(prompt).toContain("passwords");
    expect(prompt).toContain("OTPs");
    expect(prompt).toContain("untrusted data");
  });

  it("builds explain prompt with explain instructions and page context", () => {
    const prompt = buildPrompt({
      task: "explain",
      page: "Quantum superposition allows particles to exist in multiple states.",
      userText: "Explain this selection clearly.",
      language: "en",
    });

    expect(prompt).toContain("EXPLAIN INSTRUCTION: You are explaining selected text from the page.");
    expect(prompt).toContain("PAGE CONTEXT:\nQuantum superposition");
  });

  it("builds translate prompt with targetLanguage and overrides global language toggle", () => {
    const prompt = buildPrompt({
      task: "translate",
      targetLanguage: "hi",
      language: "en",
      page: "Good morning! Welcome to Sahayak.",
      userText: "Translate this selection.",
    });

    expect(prompt).toContain("TRANSLATE INSTRUCTION:");
    expect(prompt).toContain("LANGUAGE INSTRUCTION: Translate into Hindi (हिन्दी).");
    expect(prompt).not.toContain("Respond in clear, concise English.");
  });

  it("builds draft_reply prompt with draft instructions and user profile", () => {
    const prompt = buildPrompt({
      task: "draft_reply",
      page: "Can you send the project report by 5 PM today?",
      userText: "Draft a reply to this message.",
      profile: { name: "Rohan", role: "Developer" },
      language: "hinglish",
    });

    expect(prompt).toContain("DRAFT INSTRUCTION:");
    expect(prompt).toContain("USER PROFILE:");
    expect(prompt).toContain("Rohan");
    expect(prompt).toContain("Hinglish");
  });

  it("builds agent_act prompt with user profile for form-fill tasks (Slice 14)", () => {
    const prompt = buildPrompt({
      task: "agent_act",
      page: '[1] input "Full Name"\n[2] input "Email"',
      userText: "Fill the form from my profile",
      profile: { name: "Priya Sharma", college: "IIT Delhi", email: "priya@college.edu" },
    });

    expect(prompt).toContain("USER PROFILE:");
    expect(prompt).toContain("Priya Sharma");
    expect(prompt).toContain("IIT Delhi");
  });

  it("strictly omits user profile when page is sensitive (architecture §9.5 & Slice 14)", () => {
    const promptDraft = buildPrompt({
      task: "draft_reply",
      page: "Payment receipt on bank checkout",
      userText: "Draft response",
      profile: { name: "Priya Sharma", college: "IIT Delhi" },
      isSensitive: true,
    });
    expect(promptDraft).not.toContain("USER PROFILE:");
    expect(promptDraft).not.toContain("Priya Sharma");

    const promptAct = buildPrompt({
      task: "agent_act",
      page: '[1] input "Account Number"',
      userText: "Fill account info",
      profile: { name: "Priya Sharma" },
      isSensitive: true,
    });
    expect(promptAct).not.toContain("USER PROFILE:");
    expect(promptAct).not.toContain("Priya Sharma");
  });

  it("omits profile for non-fill/non-draft tasks even if profile is provided", () => {
    const promptSummary = buildPrompt({
      task: "summary",
      page: "News article text",
      userText: "Summarise article",
      profile: { name: "Priya Sharma", college: "IIT Delhi" },
    });
    expect(promptSummary).not.toContain("USER PROFILE:");

    const promptExplain = buildPrompt({
      task: "explain",
      page: "Quantum computing overview",
      userText: "Explain concept",
      profile: { name: "Priya Sharma" },
    });
    expect(promptExplain).not.toContain("USER PROFILE:");
  });
});
