import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDelete, mockGetMemoryMeta, mockDeleteById } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockGetMemoryMeta: vi.fn(),
  mockDeleteById: vi.fn(),
}));

vi.mock("../qdrant.js", () => ({
  qd: { delete: mockDelete },
}));
vi.mock("../storage.js", () => ({
  getMemoryMeta: mockGetMemoryMeta,
  deleteById: mockDeleteById,
}));
vi.mock("../util.js", () => ({
  colForType: (t: string) => `memory_${t}`,
}));

import { forgetTool } from "./forget.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("forgetTool", () => {
  it("returns 'not found' message when memory does not exist", async () => {
    mockGetMemoryMeta.mockResolvedValue(null);
    const result = await forgetTool({ memory_id: "missing-id" });
    expect(result).toBe("not found: missing-id");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes from Qdrant and calls deleteById when found", async () => {
    mockGetMemoryMeta.mockResolvedValue({ memoryType: "episodic", projectId: "proj" });
    mockDelete.mockResolvedValue({});
    mockDeleteById.mockResolvedValue(undefined);

    const result = await forgetTool({ memory_id: "abc-123" });

    expect(result).toBe("deleted: abc-123");
    expect(mockDelete).toHaveBeenCalledWith(
      "memory_episodic",
      { points: ["abc-123"] }
    );
    expect(mockDeleteById).toHaveBeenCalledWith("abc-123");
  });

  it("passes the correct collection derived from memoryType", async () => {
    mockGetMemoryMeta.mockResolvedValue({ memoryType: "semantic", projectId: "p" });
    mockDelete.mockResolvedValue({});
    mockDeleteById.mockResolvedValue(undefined);

    await forgetTool({ memory_id: "sem-id" });

    expect(mockDelete).toHaveBeenCalledWith("memory_semantic", expect.anything());
  });
});
