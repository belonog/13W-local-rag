import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockScroll, mockDelete, mockStoreMemory, mockCallLlmSimple, mockDeleteById } = vi.hoisted(() => ({
  mockScroll: vi.fn(),
  mockDelete: vi.fn(),
  mockStoreMemory: vi.fn(),
  mockCallLlmSimple: vi.fn(),
  mockDeleteById: vi.fn(),
}));

vi.mock("../qdrant.js", () => ({
  qd: { scroll: mockScroll, delete: mockDelete },
  colName: (b: string) => b,
}));
vi.mock("../config.js", () => ({
  cfg: { routerConfig: null, debugLogPath: "" },
  getProjectId: vi.fn(() => "proj"),
}));
vi.mock("../storage.js", () => ({
  deleteById: mockDeleteById,
}));
vi.mock("../util.js", () => ({
  storeMemory: mockStoreMemory,
  colForType: (t: string) => `memory_${t}`,
  debugLog: vi.fn(),
}));
vi.mock("../llm-client.js", () => ({
  callLlmSimple: mockCallLlmSimple,
  defaultRouterSpec: vi.fn(() => ({ provider: "ollama", model: "gemma3n:e2b" })),
}));

import { consolidateTool } from "./consolidate.js";

const baseArgs = {
  source: "episodic",
  target: "semantic",
  similarity_threshold: 0.9,
  dry_run: true,
};

function makePoint(id: string, text: string, vec: number[]) {
  return {
    id,
    vector: vec,
    payload: { content: text, importance: 0.5, project_id: "proj" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("consolidateTool — no records", () => {
  it("returns early message when collection is empty", async () => {
    mockScroll.mockResolvedValue({ points: [] });
    const result = await consolidateTool(baseArgs);
    expect(result).toBe("no records to consolidate.");
  });
});

describe("consolidateTool — no groups", () => {
  it("reports no groups when all points are unique", async () => {
    mockScroll.mockResolvedValue({
      points: [
        makePoint("a", "text a", [1, 0]),
        makePoint("b", "text b", [0, 1]),
      ],
    });

    const result = await consolidateTool(baseArgs);
    expect(result).toContain("no groups to merge");
  });
});

describe("consolidateTool — dry run with groups", () => {
  it("reports groups but does not write to Qdrant in dry run", async () => {
    const vec = [1, 0];
    mockScroll.mockResolvedValue({
      points: [
        makePoint("a", "text a", vec),
        makePoint("b", "text b", vec),
      ],
    });

    const result = await consolidateTool({ ...baseArgs, dry_run: true });

    expect(result).toContain("Found 1 groups");
    expect(result).toContain("Dry run");
    expect(mockStoreMemory).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("consolidateTool — actual merge (dry_run=false)", () => {
  it("calls storeMemory and delete when groups exist", async () => {
    const vec = [0.7071, 0.7071];
    mockScroll.mockResolvedValue({
      points: [
        makePoint("a", "text a", vec),
        makePoint("b", "text b", vec),
      ],
    });
    mockCallLlmSimple.mockResolvedValue('{"text": "synthesized insight", "status": "resolved"}');
    mockStoreMemory.mockResolvedValue("stored: new-id");
    mockDelete.mockResolvedValue({});
    mockDeleteById.mockResolvedValue(undefined);

    const result = await consolidateTool({ ...baseArgs, dry_run: false });

    expect(mockStoreMemory).toHaveBeenCalledWith(
      expect.objectContaining({ content: "synthesized insight" })
    );
    expect(mockDelete).toHaveBeenCalled();
    expect(result).toContain("Synthesized");
  });

  it("falls back to joined text when LLM synthesis fails", async () => {
    const vec = [1, 0];
    mockScroll.mockResolvedValue({
      points: [
        makePoint("x", "part one", vec),
        makePoint("y", "part two", vec),
      ],
    });
    mockCallLlmSimple.mockRejectedValue(new Error("LLM unavailable"));
    mockStoreMemory.mockResolvedValue("ok");
    mockDelete.mockResolvedValue({});
    mockDeleteById.mockResolvedValue(undefined);

    await consolidateTool({ ...baseArgs, dry_run: false });

    expect(mockStoreMemory).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("[Consolidated]") })
    );
  });

  it("falls back to joined text when LLM returns placeholder '...'", async () => {
    const vec = [1, 0];
    mockScroll.mockResolvedValue({
      points: [
        makePoint("p", "part a", vec),
        makePoint("q", "part b", vec),
      ],
    });
    mockCallLlmSimple.mockResolvedValue('{"text": "...", "status": "resolved"}');
    mockStoreMemory.mockResolvedValue("ok");
    mockDelete.mockResolvedValue({});
    mockDeleteById.mockResolvedValue(undefined);

    await consolidateTool({ ...baseArgs, dry_run: false });

    expect(mockStoreMemory).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("[Consolidated]") })
    );
  });
});
