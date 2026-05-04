import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEmbedOne, mockQuery, mockSearch, mockRerank, mockCallLlmSimple } = vi.hoisted(() => ({
  mockEmbedOne: vi.fn(),
  mockQuery: vi.fn(),
  mockSearch: vi.fn(),
  mockRerank: vi.fn(),
  mockCallLlmSimple: vi.fn(),
}));

vi.mock("../embedder.js", () => ({ embedOne: mockEmbedOne }));
vi.mock("../qdrant.js", () => ({
  qd: { query: mockQuery, search: mockSearch },
  CODE_VECTORS: { code: "code_vector", description: "description_vector" },
  colName: (b: string) => b,
}));
vi.mock("../config.js", () => ({
  cfg: { routerConfig: null, debugLogPath: "" },
  getProjectId: vi.fn(() => "proj"),
  getCurrentBranchCached: vi.fn(() => "main"),
}));
vi.mock("../reranker.js", () => ({ rerank: mockRerank }));
vi.mock("../llm-client.js", () => ({
  callLlmSimple: mockCallLlmSimple,
  defaultRouterSpec: vi.fn(() => ({ provider: "ollama", model: "gemma3n:e2b" })),
}));
vi.mock("../util.js", () => ({ debugLog: vi.fn() }));

import { searchCodeTool } from "./search_code.js";

const baseArgs = {
  query: "parse typescript imports",
  file_path: "",
  chunk_type: "",
  limit: 5,
  search_mode: "hybrid" as const,
  rerank: false,
  rerank_k: 50,
  top: 5,
  name_pattern: "",
  branch: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedOne.mockResolvedValue([0.1, 0.2]);
  mockQuery.mockResolvedValue({ points: [] });
  mockSearch.mockResolvedValue([]);
});

describe("searchCodeTool", () => {
  it("returns 'nothing found' when no hits", async () => {
    const result = await searchCodeTool(baseArgs);
    expect(result).toBe("nothing found in codebase.");
  });

  it("uses hybrid mode (query API) by default", async () => {
    await searchCodeTool(baseArgs);
    expect(mockQuery).toHaveBeenCalledWith("code_chunks", expect.any(Object));
  });

  it("falls back to search when hybrid query fails", async () => {
    mockQuery.mockRejectedValue(new Error("query not supported"));
    await searchCodeTool(baseArgs);
    expect(mockSearch).toHaveBeenCalled();
  });

  it("uses qd.search in code mode", async () => {
    await searchCodeTool({ ...baseArgs, search_mode: "code" });
    expect(mockSearch).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("uses qd.search in semantic mode", async () => {
    await searchCodeTool({ ...baseArgs, search_mode: "semantic" });
    expect(mockSearch).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("uses qd.search in lexical mode", async () => {
    await searchCodeTool({ ...baseArgs, search_mode: "lexical" });
    expect(mockSearch).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("formats hits into readable output", async () => {
    mockQuery.mockResolvedValue({
      points: [
        {
          id: "chunk-1",
          score: 0.91,
          payload: {
            chunk_type: "function",
            file_path: "src/parser.ts",
            start_line: 10,
            end_line: 25,
            name: "parseImports",
            content: "function parseImports() {}",
          },
        },
      ],
    });

    const result = await searchCodeTool(baseArgs);
    expect(result).toContain("parseImports");
    expect(result).toContain("src/parser.ts");
    expect(result).toContain("function");
    expect(result).toContain("Found 1 code chunks");
  });

  it("calls rerank when rerank=true and hits exist", async () => {
    mockQuery.mockResolvedValue({
      points: [
        { id: "x", score: 0.8, payload: { chunk_type: "function", content: "fn" } },
      ],
    });
    mockRerank.mockResolvedValue([
      { id: "x", score: 0.95, payload: { chunk_type: "function", content: "fn" } },
    ]);

    await searchCodeTool({ ...baseArgs, rerank: true });
    expect(mockRerank).toHaveBeenCalled();
  });

  it("does not call rerank when hits are empty", async () => {
    mockQuery.mockResolvedValue({ points: [] });
    await searchCodeTool({ ...baseArgs, rerank: true });
    expect(mockRerank).not.toHaveBeenCalled();
  });

  it("translates Cyrillic query before embedding", async () => {
    mockCallLlmSimple.mockResolvedValue("parse TypeScript imports");
    await searchCodeTool({ ...baseArgs, query: "парсить импорты" });
    expect(mockCallLlmSimple).toHaveBeenCalled();
  });

  it("uses branch override when provided", async () => {
    await searchCodeTool({ ...baseArgs, branch: "feature/xyz" });
    const call = mockQuery.mock.calls[0]!;
    expect(JSON.stringify(call[1])).toContain("feature/xyz");
  });
});
