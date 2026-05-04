import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCallLlmTool } = vi.hoisted(() => ({
  mockCallLlmTool: vi.fn(),
}));

vi.mock("./llm-client.js", () => ({
  callLlmTool: mockCallLlmTool,
  defaultRouterSpec: vi.fn(() => ({
    provider: "ollama",
    model: "gemma3n:e2b",
  })),
}));
vi.mock("./config.js", () => ({
  cfg: { routerConfig: null, debugLogPath: "" },
}));
vi.mock("./util.js", () => ({
  debugLog: vi.fn(),
}));

import { runRouter } from "./router.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runRouter", () => {
  it("returns empty array when LLM returns null", async () => {
    mockCallLlmTool.mockResolvedValue(null);
    const result = await runRouter("transcript");
    expect(result).toEqual([]);
  });

  it("returns empty array when operations is missing", async () => {
    mockCallLlmTool.mockResolvedValue({ other: "field" });
    const result = await runRouter("transcript");
    expect(result).toEqual([]);
  });

  it("returns valid operations with confidence > 0.4", async () => {
    mockCallLlmTool.mockResolvedValue({
      operations: [
        { text: "Bug found in parser", status: "resolved", confidence: 0.9 },
        { text: "Possible memory leak", status: "open_question", confidence: 0.7 },
      ],
    });

    const result = await runRouter("transcript");
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("Bug found in parser");
    expect(result[0]!.status).toBe("resolved");
    expect(result[0]!.confidence).toBe(0.9);
  });

  it("filters out operations with invalid status", async () => {
    mockCallLlmTool.mockResolvedValue({
      operations: [
        { text: "valid", status: "resolved", confidence: 0.8 },
        { text: "bad", status: "unknown_status", confidence: 0.9 },
      ],
    });

    const result = await runRouter("transcript");
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("valid");
  });

  it("filters out operations with confidence < 0.4", async () => {
    mockCallLlmTool.mockResolvedValue({
      operations: [
        { text: "low confidence", status: "resolved", confidence: 0.3 },
        { text: "high confidence", status: "in_progress", confidence: 0.8 },
      ],
    });

    const result = await runRouter("transcript");
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("high confidence");
  });

  it("filters out operations with empty text", async () => {
    mockCallLlmTool.mockResolvedValue({
      operations: [
        { text: "", status: "resolved", confidence: 0.9 },
        { text: "  ", status: "resolved", confidence: 0.9 },
        { text: "good", status: "resolved", confidence: 0.9 },
      ],
    });

    const result = await runRouter("transcript");
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("good");
  });

  it("returns empty array when LLM throws and no fallback", async () => {
    mockCallLlmTool.mockRejectedValue(new Error("timeout"));
    const result = await runRouter("transcript");
    expect(result).toEqual([]);
  });

  it("accepts all valid status values", async () => {
    const statuses = ["in_progress", "resolved", "open_question", "hypothesis", "observation"];
    mockCallLlmTool.mockResolvedValue({
      operations: statuses.map((s) => ({ text: `text for ${s}`, status: s, confidence: 0.8 })),
    });

    const result = await runRouter("transcript");
    expect(result).toHaveLength(statuses.length);
  });

  it("handles non-array operations gracefully", async () => {
    mockCallLlmTool.mockResolvedValue({ operations: "not-an-array" });
    const result = await runRouter("transcript");
    expect(result).toEqual([]);
  });
});
