import { describe, it, expect } from "vitest";
import { requestValidationTool } from "./request-validation.js";

describe("requestValidationTool", () => {
  it("includes proposed text and status in output", () => {
    const result = requestValidationTool({
      proposed_text: "Auth middleware stores tokens insecurely",
      proposed_status: "resolved",
      similar_entry: "",
      question: "Is this already resolved?",
    });

    expect(result).toContain("Auth middleware stores tokens insecurely");
    expect(result).toContain("resolved");
    expect(result).toContain("Is this already resolved?");
  });

  it("omits Similar entry line when similar_entry is empty", () => {
    const result = requestValidationTool({
      proposed_text: "text",
      proposed_status: "in_progress",
      similar_entry: "",
      question: "q",
    });

    expect(result).not.toContain("Similar entry:");
  });

  it("includes Similar entry line when provided", () => {
    const result = requestValidationTool({
      proposed_text: "text",
      proposed_status: "open_question",
      similar_entry: "existing entry about tokens",
      question: "q",
    });

    expect(result).toContain("Similar entry:   existing entry about tokens");
  });

  it("always includes the three response options", () => {
    const result = requestValidationTool({
      proposed_text: "t",
      proposed_status: "hypothesis",
      similar_entry: "",
      question: "q",
    });

    expect(result).toContain("confirmed");
    expect(result).toContain("corrected:<status>");
    expect(result).toContain("skip");
  });

  it("starts with the header line", () => {
    const result = requestValidationTool({
      proposed_text: "t",
      proposed_status: "resolved",
      similar_entry: "",
      question: "q",
    });

    expect(result.startsWith("Memory validation request from router:")).toBe(true);
  });
});
