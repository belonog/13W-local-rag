import { describe, it, expect, beforeEach } from "vitest";
import { colName, setCollectionPrefix, setEmbedDim, COLLECTIONS, CODE_VECTORS } from "./qdrant.js";

describe("colName", () => {
  beforeEach(() => {
    setCollectionPrefix("");
  });

  it("returns base name when no prefix set", () => {
    expect(colName("memory_episodic")).toBe("memory_episodic");
  });

  it("prepends prefix with underscore", () => {
    setCollectionPrefix("proj");
    expect(colName("memory_episodic")).toBe("proj_memory_episodic");
  });

  it("reverts to no prefix after reset", () => {
    setCollectionPrefix("proj");
    setCollectionPrefix("");
    expect(colName("code_chunks")).toBe("code_chunks");
  });

  it("handles empty base name", () => {
    setCollectionPrefix("pfx");
    expect(colName("")).toBe("pfx_");
  });
});

describe("setCollectionPrefix", () => {
  it("affects subsequent colName calls", () => {
    setCollectionPrefix("test_ns");
    expect(colName("feedback")).toBe("test_ns_feedback");
    setCollectionPrefix("");
  });
});

describe("setEmbedDim", () => {
  it("does not throw for valid dimensions", () => {
    expect(() => setEmbedDim(768)).not.toThrow();
    expect(() => setEmbedDim(384)).not.toThrow();
  });
});

describe("COLLECTIONS", () => {
  it("contains expected collection names", () => {
    expect(COLLECTIONS).toContain("memory_episodic");
    expect(COLLECTIONS).toContain("memory_semantic");
    expect(COLLECTIONS).toContain("memory_procedural");
    expect(COLLECTIONS).toContain("code_chunks");
    expect(COLLECTIONS).toContain("feedback");
  });
});

describe("CODE_VECTORS", () => {
  it("has code and description vector names", () => {
    expect(CODE_VECTORS.code).toBe("code_vector");
    expect(CODE_VECTORS.description).toBe("description_vector");
  });
});
