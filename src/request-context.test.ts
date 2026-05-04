import { describe, it, expect } from "vitest";
import { runWithContext, getProjectId, getProjectDir, requestContext } from "./request-context.js";

describe("getProjectId", () => {
  it("returns 'default' outside any context", () => {
    expect(getProjectId()).toBe("default");
  });

  it("returns projectId from active context", () => {
    runWithContext({ projectId: "my-project" }, () => {
      expect(getProjectId()).toBe("my-project");
    });
  });

  it("does not leak context outside the callback", () => {
    runWithContext({ projectId: "temp" }, () => {});
    expect(getProjectId()).toBe("default");
  });
});

describe("getProjectDir", () => {
  it("returns undefined outside any context", () => {
    expect(getProjectDir()).toBeUndefined();
  });

  it("returns undefined when context has no projectDir", () => {
    runWithContext({ projectId: "x" }, () => {
      expect(getProjectDir()).toBeUndefined();
    });
  });

  it("returns projectDir when set", () => {
    runWithContext({ projectId: "x", projectDir: "/home/user/project" }, () => {
      expect(getProjectDir()).toBe("/home/user/project");
    });
  });
});

describe("runWithContext", () => {
  it("returns the value produced by fn", () => {
    const result = runWithContext({ projectId: "p" }, () => 42);
    expect(result).toBe(42);
  });

  it("nests contexts correctly", () => {
    runWithContext({ projectId: "outer" }, () => {
      expect(getProjectId()).toBe("outer");
      runWithContext({ projectId: "inner" }, () => {
        expect(getProjectId()).toBe("inner");
      });
      expect(getProjectId()).toBe("outer");
    });
  });

  it("exposes the same store via requestContext export", () => {
    runWithContext({ projectId: "check" }, () => {
      expect(requestContext.getStore()?.projectId).toBe("check");
    });
  });
});
