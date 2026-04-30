import { describe, it, expect } from "vitest";
import { timeDecay, finalScore } from "./scoring.js";

describe("timeDecay", () => {
  it("returns 1.0 for brand-new date", () => {
    const now = new Date().toISOString();
    expect(timeDecay(now)).toBeCloseTo(1.0, 5);
  });

  it("returns ~0.5 at default half-life (7 days)", () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    expect(timeDecay(sevenDaysAgo)).toBeCloseTo(0.5, 5);
  });

  it("returns ~0.25 at two half-lives (14 days)", () => {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
    expect(timeDecay(fourteenDaysAgo)).toBeCloseTo(0.25, 5);
  });

  it("respects custom half-life", () => {
    const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
    expect(timeDecay(oneDayAgo, 1)).toBeCloseTo(0.5, 5);
  });

  it("is monotonically decreasing over time", () => {
    const d1 = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const d7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const d30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(timeDecay(d1)).toBeGreaterThan(timeDecay(d7));
    expect(timeDecay(d7)).toBeGreaterThan(timeDecay(d30));
  });
});

describe("finalScore", () => {
  const freshDate = new Date().toISOString();

  it("applyDecay=false: score = cosine * 1.0 * (0.3 + 0.7 * importance)", () => {
    // cosine=1, importance=1, decay=1: 1*(0.5+0.5)*1*(0.3+0.7) = 1
    expect(finalScore(1.0, freshDate, 1.0, false)).toBeCloseTo(1.0);
  });

  it("importance=0 gives minimum weight (0.3 factor)", () => {
    // cosine=1, importance=0, no decay: 1 * 1.0 * 0.3 = 0.3
    expect(finalScore(1.0, freshDate, 0, false)).toBeCloseTo(0.3);
  });

  it("cosine=0 gives zero score regardless of importance", () => {
    expect(finalScore(0, freshDate, 1.0, false)).toBeCloseTo(0);
  });

  it("applyDecay=true with fresh date equals applyDecay=false", () => {
    const scoreDecayed = finalScore(0.8, freshDate, 0.5, true);
    const scoreFlat = finalScore(0.8, freshDate, 0.5, false);
    expect(scoreDecayed).toBeCloseTo(scoreFlat, 3);
  });

  it("applyDecay=true reduces score for old entries", () => {
    const oldDate = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const scoreDecayed = finalScore(1.0, oldDate, 1.0, true);
    const scoreFlat = finalScore(1.0, oldDate, 1.0, false);
    expect(scoreDecayed).toBeLessThan(scoreFlat);
  });

  it("produces values in a reasonable range [0, 1] for valid inputs", () => {
    const score = finalScore(0.75, freshDate, 0.8, true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
