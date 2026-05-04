import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCount, mockTopAccessed } = vi.hoisted(() => ({
  mockCount: vi.fn(),
  mockTopAccessed: vi.fn(),
}));

vi.mock("../qdrant.js", () => ({
  qd: { count: mockCount },
  COLLECTIONS: ["memory_episodic", "memory_semantic", "code_chunks"],
  colName: (b: string) => b,
}));
vi.mock("../storage.js", () => ({
  topAccessed: mockTopAccessed,
}));
vi.mock("../config.js", () => ({
  getProjectId: vi.fn(() => "test-project"),
}));

import { statsTool } from "./stats.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("statsTool", () => {
  it("includes the project ID in the output", async () => {
    mockCount.mockResolvedValue({ count: 0 });
    mockTopAccessed.mockResolvedValue([]);

    const result = await statsTool();
    expect(result).toContain("test-project");
  });

  it("shows count for each collection", async () => {
    mockCount.mockImplementation((col: string) => {
      const counts: Record<string, number> = {
        "memory_episodic": 42,
        "memory_semantic": 7,
        "code_chunks": 1000,
      };
      return Promise.resolve({ count: counts[col] ?? 0 });
    });
    mockTopAccessed.mockResolvedValue([]);

    const result = await statsTool();
    expect(result).toContain("42");
    expect(result).toContain("7");
    expect(result).toContain("1000");
  });

  it("shows N/A when a collection count fails", async () => {
    mockCount.mockRejectedValue(new Error("collection not found"));
    mockTopAccessed.mockResolvedValue([]);

    const result = await statsTool();
    expect(result).toContain("N/A");
  });

  it("shows most accessed entries when present", async () => {
    mockCount.mockResolvedValue({ count: 0 });
    mockTopAccessed.mockResolvedValue([
      { id: "id-1", memoryType: "episodic", accessCount: 15 },
      { id: "id-2", memoryType: "semantic", accessCount: 8 },
    ]);

    const result = await statsTool();
    expect(result).toContain("id-1");
    expect(result).toContain("x15");
    expect(result).toContain("id-2");
  });

  it("omits 'Most accessed' section when no entries", async () => {
    mockCount.mockResolvedValue({ count: 0 });
    mockTopAccessed.mockResolvedValue([]);

    const result = await statsTool();
    expect(result).not.toContain("Most accessed");
  });
});
