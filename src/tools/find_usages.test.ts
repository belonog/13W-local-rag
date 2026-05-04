import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRetrieve, mockSearch, mockEmbedOne } = vi.hoisted(() => ({
  mockRetrieve: vi.fn(),
  mockSearch: vi.fn(),
  mockEmbedOne: vi.fn(),
}));

vi.mock("../qdrant.js", () => ({
  qd: { retrieve: mockRetrieve, search: mockSearch },
  CODE_VECTORS: { code: "code_vector", description: "description_vector" },
  colName: (b: string) => b,
}));
vi.mock("../embedder.js", () => ({ embedOne: mockEmbedOne }));
vi.mock("../config.js", () => ({
  cfg: { debugLogPath: "" },
  getProjectId: vi.fn(() => "proj"),
  getCurrentBranchCached: vi.fn(() => "main"),
}));

import { findUsagesTool } from "./find_usages.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedOne.mockResolvedValue([0.1, 0.2]);
  mockSearch.mockResolvedValue([]);
});

describe("findUsagesTool", () => {
  it("returns not found when symbol ID does not exist", async () => {
    mockRetrieve.mockResolvedValue([]);
    const result = await findUsagesTool({ symbol_id: "missing-id", limit: 10 });
    expect(result).toContain("not found");
  });

  it("returns error when symbol has no name", async () => {
    mockRetrieve.mockResolvedValue([{ id: "x", payload: { file_path: "src/foo.ts" } }]);
    const result = await findUsagesTool({ symbol_id: "x", limit: 10 });
    expect(result).toContain("has no name");
  });

  it("returns 'no usages found' when all search legs return empty", async () => {
    mockRetrieve.mockResolvedValue([{
      id: "sym-1",
      payload: { name: "myFunc", file_path: "src/util.ts", signature: "myFunc()" },
    }]);
    mockSearch.mockResolvedValue([]);

    const result = await findUsagesTool({ symbol_id: "sym-1", limit: 10 });
    expect(result).toContain("No usages found");
  });

  it("returns formatted usages when lexical hits exist", async () => {
    mockRetrieve.mockResolvedValue([{
      id: "sym-1",
      payload: { name: "myFunc", file_path: "src/util.ts", signature: "myFunc()" },
    }]);
    mockSearch
      .mockResolvedValueOnce([
        {
          id: "usage-1",
          score: 0.9,
          payload: {
            chunk_type: "function",
            file_path: "src/caller.ts",
            start_line: 5,
            end_line: 10,
            name: "caller",
            content: "const x = myFunc()",
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await findUsagesTool({ symbol_id: "sym-1", limit: 10 });
    expect(result).toContain("myFunc");
    expect(result).toContain("src/caller.ts");
    expect(result).toContain("[lexical]");
  });

  it("excludes the symbol itself from usages", async () => {
    mockRetrieve.mockResolvedValue([{
      id: "sym-1",
      payload: { name: "fn", file_path: "src/foo.ts", signature: "fn()" },
    }]);
    mockSearch.mockResolvedValue([{
      id: "sym-1",
      score: 0.99,
      payload: { chunk_type: "function", file_path: "src/foo.ts", content: "fn definition" },
    }]);

    const result = await findUsagesTool({ symbol_id: "sym-1", limit: 10 });
    expect(result).toContain("No usages found");
  });

  it("caps limit at 50", async () => {
    mockRetrieve.mockResolvedValue([{
      id: "sym-1",
      payload: { name: "fn", file_path: "src/foo.ts" },
    }]);
    mockSearch.mockResolvedValue([]);

    await findUsagesTool({ symbol_id: "sym-1", limit: 200 });
    expect(mockEmbedOne).toHaveBeenCalled();
  });
});
