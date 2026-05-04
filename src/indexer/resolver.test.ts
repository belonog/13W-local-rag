import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ImportResolver } from "./resolver.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "resolver-test-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ImportResolver — relative imports", () => {
  it("resolves a sibling relative import", () => {
    const r = new ImportResolver({ root: tmpDir });
    const result = r.resolve("./util", "src/indexer/parser.ts");
    expect(result).toBe("src/indexer/util");
  });

  it("resolves a parent-directory import", () => {
    const r = new ImportResolver({ root: tmpDir });
    const result = r.resolve("../config", "src/indexer/parser.ts");
    expect(result).toBe("src/config");
  });

  it("resolves deep nested relative path", () => {
    const r = new ImportResolver({ root: tmpDir });
    const result = r.resolve("./a/b/c", "src/tools/foo.ts");
    expect(result).toBe("src/tools/a/b/c");
  });
});

describe("ImportResolver — node_modules pass-through", () => {
  it("keeps node_module names unchanged", () => {
    const r = new ImportResolver({ root: tmpDir });
    expect(r.resolve("lodash", "src/foo.ts")).toBe("lodash");
  });

  it("keeps scoped package names unchanged", () => {
    const r = new ImportResolver({ root: tmpDir });
    expect(r.resolve("@qdrant/js-client-rest", "src/foo.ts")).toBe("@qdrant/js-client-rest");
  });
});

describe("ImportResolver — monorepo shorthand aliases", () => {
  it("resolves @/ prefix to src/", () => {
    const r = new ImportResolver({ root: tmpDir });
    const result = r.resolve("@/util", "src/foo.ts");
    expect(result).toBe("src/util");
  });

  it("resolves ~/ prefix to src/", () => {
    const r = new ImportResolver({ root: tmpDir });
    const result = r.resolve("~/components/button", "src/foo.ts");
    expect(result).toBe("src/components/button");
  });
});

describe("ImportResolver — tsconfig paths", () => {
  it("resolves tsconfig alias to mapped path", () => {
    const tsconfig = {
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "#utils/*": ["src/shared/utils/*"],
        },
      },
    };

    writeFileSync(join(tmpDir, "tsconfig.json"), JSON.stringify(tsconfig));
    const r = new ImportResolver({ root: tmpDir });
    const result = r.resolve("#utils/format", "src/foo.ts");
    expect(result).toContain("format");
    expect(result).toContain("shared/utils");
    rmSync(join(tmpDir, "tsconfig.json"));
  });

  it("resolves exact alias match", () => {
    const tsconfig = {
      compilerOptions: {
        paths: {
          "mylib": ["src/lib/index"],
        },
      },
    };
    writeFileSync(join(tmpDir, "tsconfig.json"), JSON.stringify(tsconfig));
    const r = new ImportResolver({ root: tmpDir });
    const result = r.resolve("mylib", "src/foo.ts");
    expect(result).toContain("lib/index");
    rmSync(join(tmpDir, "tsconfig.json"));
  });

  it("works without tsconfig.json (no aliases)", () => {
    const r = new ImportResolver({ root: tmpDir });
    expect(r.resolve("./x", "src/a.ts")).toBe("src/x");
  });
});

describe("ImportResolver — empty input", () => {
  it("returns empty string for empty importPath", () => {
    const r = new ImportResolver({ root: tmpDir });
    expect(r.resolve("", "src/foo.ts")).toBe("");
  });
});

describe("ImportResolver.resolveAll", () => {
  it("filters out node_modules and returns only project-relative paths", () => {
    const r = new ImportResolver({ root: tmpDir });
    const results = r.resolveAll(
      ["./util", "lodash", "../config", "@scope/pkg"],
      "src/indexer/parser.ts"
    );
    expect(results).toContain("src/indexer/util");
    expect(results).toContain("src/config");
    expect(results).not.toContain("lodash");
    expect(results).not.toContain("@scope/pkg");
  });

  it("returns empty array for all external imports", () => {
    const r = new ImportResolver({ root: tmpDir });
    const results = r.resolveAll(["react", "lodash"], "src/foo.ts");
    expect(results).toHaveLength(0);
  });
});
