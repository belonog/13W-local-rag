import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockUpsert, mockEmbedOne, mockGetProjectId, mockGetSession } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockEmbedOne: vi.fn(),
  mockGetProjectId: vi.fn(() => "proj-1"),
  mockGetSession: vi.fn(() => null as string | null),
}));

vi.mock("../qdrant.js", () => ({
  qd: { upsert: mockUpsert },
  colName: (b: string) => b,
}));
vi.mock("../embedder.js", () => ({ embedOne: mockEmbedOne }));
vi.mock("../request-context.js", () => ({ getProjectId: mockGetProjectId }));
vi.mock("../session-store.js", () => ({ getSession: mockGetSession }));
vi.mock("../util.js", () => ({
  nowIso: vi.fn(() => "2026-01-01T00:00:00Z"),
  contentHash: vi.fn((s: string) => `hash:${s.slice(0, 8)}`),
}));

import { giveFeedbackTool } from "./give_feedback.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedOne.mockResolvedValue([0.1, 0.2, 0.3]);
  mockUpsert.mockResolvedValue({});
  mockGetProjectId.mockReturnValue("proj-1");
  mockGetSession.mockReturnValue(null);
});

describe("giveFeedbackTool", () => {
  it("upserts to feedback collection with correct payload", async () => {
    const result = await giveFeedbackTool({
      content: "great tool",
      session_id: "sess-abc",
      agent_type: "claude",
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      "feedback",
      expect.objectContaining({
        points: expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              content: "great tool",
              session_id: "sess-abc",
              project_id: "proj-1",
              agent_type: "claude",
            }),
          }),
        ]),
      })
    );
    expect(result).toContain("feedback stored");
    expect(result).toContain("sess-abc");
  });

  it("falls back to SessionStore session_id when arg is empty", async () => {
    mockGetSession.mockReturnValue("store-session-id");

    await giveFeedbackTool({ content: "feedback", session_id: "", agent_type: "" });

    const call = mockUpsert.mock.calls[0]!;
    const point = call[1].points[0];
    expect(point.payload.session_id).toBe("store-session-id");
  });

  it("falls back to 'unknown' when both session_id arg and SessionStore are empty", async () => {
    mockGetSession.mockReturnValue(null);

    await giveFeedbackTool({ content: "feedback", session_id: "", agent_type: "" });

    const call = mockUpsert.mock.calls[0]!;
    const point = call[1].points[0];
    expect(point.payload.session_id).toBe("unknown");
  });

  it("uses 'unknown' agent_type when arg is empty", async () => {
    await giveFeedbackTool({ content: "x", session_id: "s", agent_type: "" });

    const call = mockUpsert.mock.calls[0]!;
    expect(call[1].points[0].payload.agent_type).toBe("unknown");
  });

  it("sets hook_event to SessionEnd", async () => {
    await giveFeedbackTool({ content: "x", session_id: "s", agent_type: "bot" });
    const call = mockUpsert.mock.calls[0]!;
    expect(call[1].points[0].payload.hook_event).toBe("SessionEnd");
  });

  it("embeds the content and uses the vector", async () => {
    mockEmbedOne.mockResolvedValue([0.5, 0.6]);
    await giveFeedbackTool({ content: "test", session_id: "s", agent_type: "" });
    expect(mockEmbedOne).toHaveBeenCalledWith("test");
    const call = mockUpsert.mock.calls[0]!;
    expect(call[1].points[0].vector).toEqual([0.5, 0.6]);
  });
});
