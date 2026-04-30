import { describe, it, expect, vi, beforeEach } from "vitest";

// Build a 5-dimensional mock vector space: one dimension per status.
// index: 0=in_progress, 1=resolved, 2=open_question, 3=hypothesis, 4=observation
const STATUS_DIM: Record<string, number> = {
  in_progress: 0,
  resolved: 1,
  open_question: 2,
  hypothesis: 3,
  observation: 4,
};

const DIMS = 5;

function unitVec(idx: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[idx] = 1;
  return v;
}

// Count templates per status (must match status-classifier.ts TEMPLATES)
const TEMPLATE_COUNTS: Record<string, number> = {
  in_progress: 14,
  resolved: 16,
  open_question: 15,
  hypothesis: 15,
  observation: 15,
};

vi.mock("./embedder.js", () => {
  // embedBatch: return a unit vector for each phrase based on which status it belongs to.
  // The order matches the iteration order in TEMPLATES: in_progress, resolved, open_question, hypothesis, observation.
  const embedBatch = vi.fn(async (phrases: string[]) => {
    const statuses = ["in_progress", "resolved", "open_question", "hypothesis", "observation"];
    const vecs: number[][] = [];
    let phraseIdx = 0;
    for (const status of statuses) {
      const count = TEMPLATE_COUNTS[status]!;
      for (let i = 0; i < count; i++) {
        vecs.push(unitVec(STATUS_DIM[status]!));
        phraseIdx++;
      }
    }
    return vecs;
  });

  const embedOne = vi.fn(async (text: string): Promise<number[]> => {
    // Default: return a vector for "resolved"
    return unitVec(STATUS_DIM["resolved"]!);
  });

  return { embedBatch, embedOne };
});

describe("classifyStatus", () => {
  // Reset module state between tests that need fresh cache + clear mock call counts
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("classifies text as resolved when embedOne returns a resolved-aligned vector", async () => {
    const { classifyStatus } = await import("./status-classifier.js");
    const { embedOne } = await import("./embedder.js");
    vi.mocked(embedOne).mockResolvedValueOnce(unitVec(STATUS_DIM["resolved"]!));

    const result = await classifyStatus("done and implemented");
    expect(result.status).toBe("resolved");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("classifies text as in_progress when embedOne returns an in_progress-aligned vector", async () => {
    const { classifyStatus } = await import("./status-classifier.js");
    const { embedOne } = await import("./embedder.js");
    vi.mocked(embedOne).mockResolvedValueOnce(unitVec(STATUS_DIM["in_progress"]!));

    const result = await classifyStatus("still working on this");
    expect(result.status).toBe("in_progress");
  });

  it("classifies text as hypothesis when embedOne returns a hypothesis-aligned vector", async () => {
    const { classifyStatus } = await import("./status-classifier.js");
    const { embedOne } = await import("./embedder.js");
    vi.mocked(embedOne).mockResolvedValueOnce(unitVec(STATUS_DIM["hypothesis"]!));

    const result = await classifyStatus("maybe we could try this approach");
    expect(result.status).toBe("hypothesis");
  });

  it("confidence is in [0, 1]", async () => {
    const { classifyStatus } = await import("./status-classifier.js");
    const { embedOne } = await import("./embedder.js");
    vi.mocked(embedOne).mockResolvedValueOnce(unitVec(STATUS_DIM["observation"]!));

    const result = await classifyStatus("noticed something interesting");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("warmupStatusClassifier resolves without error", async () => {
    const { warmupStatusClassifier } = await import("./status-classifier.js");
    await expect(warmupStatusClassifier()).resolves.toBeUndefined();
  });

  it("embedBatch is called only once across multiple classifyStatus calls (cache)", async () => {
    const { classifyStatus } = await import("./status-classifier.js");
    const { embedOne, embedBatch } = await import("./embedder.js");

    vi.mocked(embedOne).mockResolvedValue(unitVec(STATUS_DIM["resolved"]!));

    await classifyStatus("first call");
    await classifyStatus("second call");
    await classifyStatus("third call");

    expect(vi.mocked(embedBatch)).toHaveBeenCalledTimes(1);
  });
});
