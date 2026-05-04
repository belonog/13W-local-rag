import { describe, it, expect, vi } from "vitest";

const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

import { rerank } from "./reranker.js";

describe("rerank", () => {
  it("returns the first topK hits", async () => {
    const hits = [
      { id: "1", score: 0.9, version: 0, payload: null },
      { id: "2", score: 0.8, version: 0, payload: null },
      { id: "3", score: 0.7, version: 0, payload: null },
    ] as any[];

    const result = await rerank("query", hits, 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("1");
    expect(result[1]!.id).toBe("2");
  });

  it("returns all hits when topK >= hits.length", async () => {
    const hits = [
      { id: "a", score: 0.5, version: 0, payload: null },
    ] as any[];

    const result = await rerank("q", hits, 10);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for empty input", async () => {
    const result = await rerank("q", [], 5);
    expect(result).toHaveLength(0);
  });

  it("writes a disabled message to stderr", async () => {
    stderrSpy.mockClear();
    await rerank("q", [], 1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "[reranker] disabled on this platform (FreeBSD)\n"
    );
  });
});
