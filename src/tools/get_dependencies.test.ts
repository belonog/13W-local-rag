import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDeps, mockGetReverseDeps, mockGetTransitiveDeps } = vi.hoisted(() => ({
  mockGetDeps: vi.fn(),
  mockGetReverseDeps: vi.fn(),
  mockGetTransitiveDeps: vi.fn(),
}));

vi.mock("../config.js", () => ({
  getProjectId: vi.fn(() => "proj"),
}));
vi.mock("../storage.js", () => ({
  getDeps: mockGetDeps,
  getReverseDeps: mockGetReverseDeps,
  getTransitiveDeps: mockGetTransitiveDeps,
}));

import { getDependenciesTool } from "./get_dependencies.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDeps.mockResolvedValue([]);
  mockGetReverseDeps.mockResolvedValue([]);
  mockGetTransitiveDeps.mockResolvedValue(new Map());
});

describe("getDependenciesTool", () => {
  it("shows imports section for direction='imports'", async () => {
    mockGetDeps.mockResolvedValue(["src/util.ts", "src/config.ts"]);
    const result = await getDependenciesTool({ file_path: "src/foo.ts", direction: "imports", depth: 1 });
    expect(result).toContain("Imports (2)");
    expect(result).toContain("src/util.ts");
    expect(result).toContain("src/config.ts");
    expect(result).not.toContain("Imported by");
  });

  it("shows imported_by section for direction='imported_by'", async () => {
    mockGetReverseDeps.mockResolvedValue(["src/main.ts"]);
    const result = await getDependenciesTool({ file_path: "src/util.ts", direction: "imported_by", depth: 1 });
    expect(result).toContain("Imported by (1)");
    expect(result).toContain("src/main.ts");
    expect(result).not.toContain("Imports (");
  });

  it("shows both sections for direction='both'", async () => {
    mockGetDeps.mockResolvedValue(["src/a.ts"]);
    mockGetReverseDeps.mockResolvedValue(["src/b.ts"]);
    const result = await getDependenciesTool({ file_path: "src/util.ts", direction: "both", depth: 1 });
    expect(result).toContain("Imports (1)");
    expect(result).toContain("Imported by (1)");
  });

  it("defaults to 'both' for unknown direction", async () => {
    const result = await getDependenciesTool({ file_path: "src/x.ts", direction: "unknown", depth: 1 });
    expect(result).toContain("Imports");
    expect(result).toContain("Imported by");
  });

  it("shows '(none)' when no dependencies found", async () => {
    const result = await getDependenciesTool({ file_path: "src/x.ts", direction: "imports", depth: 1 });
    expect(result).toContain("(none)");
  });

  it("uses transitive deps when depth > 1", async () => {
    mockGetTransitiveDeps.mockResolvedValue(new Map([["src/deep.ts", 2]]));
    const result = await getDependenciesTool({ file_path: "src/x.ts", direction: "imports", depth: 3 });
    expect(mockGetTransitiveDeps).toHaveBeenCalled();
    expect(result).toContain("Transitive imports");
    expect(result).toContain("src/deep.ts");
  });

  it("clamps depth to maximum of 5", async () => {
    await getDependenciesTool({ file_path: "src/x.ts", direction: "imports", depth: 99 });
    expect(mockGetTransitiveDeps).toHaveBeenCalledWith("proj", "src/x.ts", 5, "imports");
  });

  it("clamps depth to minimum of 1", async () => {
    await getDependenciesTool({ file_path: "src/x.ts", direction: "imports", depth: 0 });
    expect(mockGetDeps).toHaveBeenCalled();
    expect(mockGetTransitiveDeps).not.toHaveBeenCalled();
  });

  it("includes the file_path in the header", async () => {
    const result = await getDependenciesTool({ file_path: "src/my/module.ts", direction: "both", depth: 1 });
    expect(result).toContain("src/my/module.ts");
  });
});
