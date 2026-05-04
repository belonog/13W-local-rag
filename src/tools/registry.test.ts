import { describe, it, expect, vi } from "vitest";

// Mock all tool implementations
vi.mock("./remember.js",          () => ({ rememberTool:          vi.fn(async () => "remembered") }));
vi.mock("./recall.js",            () => ({ recallTool:            vi.fn(async () => "recalled") }));
vi.mock("./search_code.js",       () => ({ searchCodeTool:        vi.fn(async () => "found") }));
vi.mock("./forget.js",            () => ({ forgetTool:            vi.fn(async () => "forgotten") }));
vi.mock("./stats.js",             () => ({ statsTool:             vi.fn(async () => "stats") }));
vi.mock("./get_file_context.js",  () => ({ getFileContextTool:    vi.fn(async () => "file") }));
vi.mock("./get_dependencies.js",  () => ({ getDependenciesTool:   vi.fn(async () => "deps") }));
vi.mock("./project_overview.js",  () => ({ projectOverviewTool:   vi.fn(async () => "overview") }));
vi.mock("./find_usages.js",       () => ({ findUsagesTool:        vi.fn(async () => "usages") }));
vi.mock("./request-validation.js",() => ({ requestValidationTool: vi.fn(() => "validation") }));
vi.mock("./give_feedback.js",     () => ({ giveFeedbackTool:      vi.fn(async () => "feedback") }));

import { TOOLS, TOOL_MAP, dispatchTool } from "./registry.js";

// ── TOOLS / TOOL_MAP ──────────────────────────────────────────────────────────

describe("TOOLS", () => {
  it("exports an array with all expected tool names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("remember");
    expect(names).toContain("recall");
    expect(names).toContain("search_code");
    expect(names).toContain("forget");
    expect(names).toContain("stats");
    expect(names).toContain("get_file_context");
    expect(names).toContain("get_dependencies");
    expect(names).toContain("project_overview");
    expect(names).toContain("find_usages");
    expect(names).toContain("request_validation");
    expect(names).toContain("give_feedback");
  });

  it("each tool has a name and inputSchema", () => {
    for (const tool of TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

describe("TOOL_MAP", () => {
  it("maps tool names to their definitions", () => {
    expect(TOOL_MAP.get("remember")).toBeDefined();
    expect(TOOL_MAP.get("forget")).toBeDefined();
    expect(TOOL_MAP.get("non_existent")).toBeUndefined();
  });
});

// ── dispatchTool ──────────────────────────────────────────────────────────────

describe("dispatchTool", () => {
  it("dispatches 'remember' with coerced arguments", async () => {
    const result = await dispatchTool("remember", { content: "test fact" });
    expect(result).toBe("remembered");
  });

  it("dispatches 'recall'", async () => {
    const result = await dispatchTool("recall", { query: "auth" });
    expect(result).toBe("recalled");
  });

  it("dispatches 'search_code'", async () => {
    const result = await dispatchTool("search_code", { query: "parser" });
    expect(result).toBe("found");
  });

  it("dispatches 'forget'", async () => {
    const result = await dispatchTool("forget", { memory_id: "abc" });
    expect(result).toBe("forgotten");
  });

  it("dispatches 'stats'", async () => {
    const result = await dispatchTool("stats", {});
    expect(result).toBe("stats");
  });

  it("dispatches 'project_overview'", async () => {
    const result = await dispatchTool("project_overview", {});
    expect(result).toBe("overview");
  });

  it("dispatches 'request_validation'", async () => {
    const result = await dispatchTool("request_validation", {
      proposed_text: "text",
      proposed_status: "resolved",
      question: "confirm?",
    });
    expect(result).toBe("validation");
  });

  it("returns 'unknown tool' for unrecognized tool name", async () => {
    const result = await dispatchTool("nonexistent_tool", {});
    expect(result).toBe("unknown tool: nonexistent_tool");
  });

  it("coerces string numbers to integers for 'recall' limit", async () => {
    const { recallTool } = await import("./recall.js");
    await dispatchTool("recall", { query: "q", limit: "7" });
    expect(recallTool).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 7 })
    );
  });

  it("coerces string booleans for 'recall' time_decay", async () => {
    const { recallTool } = await import("./recall.js");
    await dispatchTool("recall", { query: "q", time_decay: "false" });
    expect(recallTool).toHaveBeenCalledWith(
      expect.objectContaining({ time_decay: false })
    );
  });

  it("uses default values for missing optional arguments in 'remember'", async () => {
    const { rememberTool } = await import("./remember.js");
    await dispatchTool("remember", { content: "x" });
    expect(rememberTool).toHaveBeenCalledWith(
      expect.objectContaining({
        memory_type: "semantic",
        scope: "project",
        importance: 0.5,
        ttl_hours: 0,
      })
    );
  });
});
