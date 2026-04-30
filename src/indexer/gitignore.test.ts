import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitignoreFilter } from "./gitignore.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gitignore-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GitignoreFilter", () => {
  it("ignores nothing when no .gitignore exists", () => {
    const f = new GitignoreFilter();
    f.addDir(tmpDir);
    expect(f.isIgnored(join(tmpDir, "file.ts"))).toBe(false);
    expect(f.isIgnored(join(tmpDir, "file.log"))).toBe(false);
  });

  it("ignores files matching .gitignore pattern", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "*.log\n");
    const f = new GitignoreFilter();
    f.addDir(tmpDir);
    expect(f.isIgnored(join(tmpDir, "debug.log"))).toBe(true);
    expect(f.isIgnored(join(tmpDir, "debug.ts"))).toBe(false);
  });

  it("ignores files matching .ignore pattern", () => {
    writeFileSync(join(tmpDir, ".ignore"), "*.tmp\n");
    const f = new GitignoreFilter();
    f.addDir(tmpDir);
    expect(f.isIgnored(join(tmpDir, "cache.tmp"))).toBe(true);
    expect(f.isIgnored(join(tmpDir, "cache.ts"))).toBe(false);
  });

  it("merges rules from both .gitignore and .ignore", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "*.log\n");
    writeFileSync(join(tmpDir, ".ignore"), "*.tmp\n");
    const f = new GitignoreFilter();
    f.addDir(tmpDir);
    expect(f.isIgnored(join(tmpDir, "app.log"))).toBe(true);
    expect(f.isIgnored(join(tmpDir, "app.tmp"))).toBe(true);
    expect(f.isIgnored(join(tmpDir, "app.ts"))).toBe(false);
  });

  it("sub-directory rules do not affect parent-directory files", () => {
    const subDir = join(tmpDir, "sub");
    mkdirSync(subDir);
    writeFileSync(join(subDir, ".gitignore"), "*.ts\n");

    const f = new GitignoreFilter();
    f.addDir(tmpDir);  // no rules at root
    f.addDir(subDir);  // *.ts rule in sub

    // File in parent should NOT be ignored (sub rule doesn't apply)
    expect(f.isIgnored(join(tmpDir, "root.ts"))).toBe(false);
    // File in sub should be ignored
    expect(f.isIgnored(join(subDir, "child.ts"))).toBe(true);
  });

  it("paths outside the base directory are never matched", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "*.log\n");
    const f = new GitignoreFilter();
    f.addDir(tmpDir);

    // A path in a sibling directory (relative path starts with ..)
    const siblingPath = join(tmpDir, "..", "other.log");
    expect(f.isIgnored(siblingPath)).toBe(false);
  });

  it("stacked contexts: multiple addDir calls accumulate rules", () => {
    const subDir = join(tmpDir, "nested");
    mkdirSync(subDir);
    writeFileSync(join(tmpDir, ".gitignore"), "*.log\n");
    writeFileSync(join(subDir, ".gitignore"), "*.tmp\n");

    const f = new GitignoreFilter();
    f.addDir(tmpDir);
    f.addDir(subDir);

    // Root rule applies everywhere under root
    expect(f.isIgnored(join(tmpDir, "app.log"))).toBe(true);
    expect(f.isIgnored(join(subDir, "debug.log"))).toBe(true);
    // Sub rule applies only under sub
    expect(f.isIgnored(join(subDir, "temp.tmp"))).toBe(true);
    expect(f.isIgnored(join(tmpDir, "root.tmp"))).toBe(false);
  });

  it("addDir is a no-op when directory has no ignore files", () => {
    const emptyDir = join(tmpDir, "empty");
    mkdirSync(emptyDir);
    const f = new GitignoreFilter();
    f.addDir(emptyDir);
    expect(f.isIgnored(join(emptyDir, "anything.log"))).toBe(false);
  });
});
