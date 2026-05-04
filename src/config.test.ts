import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSetCollectionPrefix, mockSetEmbedDim, mockApplyRateLimits } = vi.hoisted(() => ({
  mockSetCollectionPrefix: vi.fn(),
  mockSetEmbedDim: vi.fn(),
  mockApplyRateLimits: vi.fn(),
}));

vi.mock("./qdrant.js", () => ({
  setCollectionPrefix: mockSetCollectionPrefix,
  setEmbedDim: mockSetEmbedDim,
}));
vi.mock("./llm-client.js", () => ({
  applyRateLimits: mockApplyRateLimits,
}));
vi.mock("./request-context.js", () => ({
  getProjectId: vi.fn(() => "default"),
}));

import { cfg, applyServerConfig, setCurrentBranch, getCurrentBranchCached } from "./config.js";
import type { ServerConfig } from "./server-config.js";

function makeServerConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    embed: {
      provider: "openai",
      model: "text-embedding-3-small",
      api_key: "sk-test",
      dim: 1536,
      url: "https://api.openai.com",
      max_chars: 8000,
      timeout: 30,
      max_attempts: 2,
    },
    llm: {
      provider: "anthropic",
      model: "claude-3-haiku-20240307",
      api_key: "sk-ant",
      url: "",
      timeout: 60,
      max_attempts: 3,
      fallback: null,
    },
    router: {
      provider: "anthropic",
      model: "claude-3-haiku-20240307",
      api_key: "sk-ant",
      url: "",
      timeout: 60,
      max_attempts: 3,
      fallback: null,
    },
    rate_limits: {},
    collection_prefix: "myns",
    port: 8080,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("applyServerConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates cfg.embedProvider from ServerConfig", () => {
    applyServerConfig(makeServerConfig());
    expect(cfg.embedProvider).toBe("openai");
  });

  it("updates cfg.embedModel", () => {
    applyServerConfig(makeServerConfig());
    expect(cfg.embedModel).toBe("text-embedding-3-small");
  });

  it("updates cfg.embedDim", () => {
    applyServerConfig(makeServerConfig());
    expect(cfg.embedDim).toBe(1536);
  });

  it("updates cfg.llmProvider", () => {
    applyServerConfig(makeServerConfig());
    expect(cfg.llmProvider).toBe("anthropic");
  });

  it("updates cfg.collectionPrefix", () => {
    applyServerConfig(makeServerConfig());
    expect(cfg.collectionPrefix).toBe("myns");
  });

  it("updates cfg.port", () => {
    applyServerConfig(makeServerConfig());
    expect(cfg.port).toBe(8080);
  });

  it("sets cfg.projectId when projectId argument is provided", () => {
    applyServerConfig(makeServerConfig(), "proj-123");
    expect(cfg.projectId).toBe("proj-123");
  });

  it("does not change cfg.projectId when projectId argument is omitted", () => {
    const before = cfg.projectId;
    applyServerConfig(makeServerConfig());
    expect(cfg.projectId).toBe(before);
  });

  it("calls setCollectionPrefix with the prefix from ServerConfig", () => {
    applyServerConfig(makeServerConfig({ collection_prefix: "ns2" }));
    expect(mockSetCollectionPrefix).toHaveBeenCalledWith("ns2");
  });

  it("calls setEmbedDim with the dim from ServerConfig", () => {
    applyServerConfig(makeServerConfig());
    expect(mockSetEmbedDim).toHaveBeenCalledWith(1536);
  });

  it("calls applyRateLimits with the rate_limits map", () => {
    const rl = { "gemma3n:e2b": { size: 10, window: 60 } };
    applyServerConfig(makeServerConfig({ rate_limits: rl }));
    expect(mockApplyRateLimits).toHaveBeenCalledWith(rl);
  });

  it("calls applyRateLimits with empty object when rate_limits is undefined", () => {
    const sc = makeServerConfig();
    (sc as any).rate_limits = undefined;
    applyServerConfig(sc);
    expect(mockApplyRateLimits).toHaveBeenCalledWith({});
  });
});

describe("setCurrentBranch / getCurrentBranchCached", () => {
  it("returns 'default' initially", () => {
    expect(getCurrentBranchCached()).toBe("default");
  });

  it("returns the value set by setCurrentBranch", () => {
    setCurrentBranch("feature/test");
    expect(getCurrentBranchCached()).toBe("feature/test");
    setCurrentBranch("default");
  });

  it("allows switching branches multiple times", () => {
    setCurrentBranch("main");
    setCurrentBranch("dev");
    expect(getCurrentBranchCached()).toBe("dev");
    setCurrentBranch("default");
  });
});
