import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Queue } from "./queue.js";

describe("Queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("acquires immediately when under the rate limit", async () => {
    const q = new Queue(3, 1);
    await q.acquire();
    await q.acquire();
    await q.acquire();
  });

  it("blocks when window is full, resolves after window expires", async () => {
    const q = new Queue(2, 1); // 2 per second

    await q.acquire();
    await q.acquire();

    let resolved = false;
    const p = q.acquire().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1002);
    await p;

    expect(resolved).toBe(true);
  });

  it("pause delays subsequent acquire for the pause duration", async () => {
    const q = new Queue(10, 60);
    q.pause(2000);

    let resolved = false;
    const p = q.acquire().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    await p;
    expect(resolved).toBe(true);
  });

  it("pause does not shorten an existing longer pause", async () => {
    const q = new Queue(10, 60);
    q.pause(3000);
    q.pause(500); // shorter — should not override

    let resolved = false;
    const p = q.acquire().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(resolved).toBe(false); // still blocked by the 3s pause
    await vi.advanceTimersByTimeAsync(1010);
    await p;
    expect(resolved).toBe(true);
  });

  it("trim removes expired timestamps so slots become available", async () => {
    const q = new Queue(1, 1);
    await q.acquire();

    // Advance past the window so the slot expires, then trim
    await vi.advanceTimersByTimeAsync(1001);
    q.trim();

    // Should acquire immediately now
    let resolved = false;
    q.acquire().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });

  it("concurrent acquires are serialized within the window limit", async () => {
    const q = new Queue(2, 1); // 2 per second
    const order: number[] = [];

    const tasks = [1, 2, 3].map((n) =>
      q.acquire().then(() => {
        order.push(n);
      })
    );

    // First 2 resolve immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1, 2]);

    // Third resolves after window
    await vi.advanceTimersByTimeAsync(1002);
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3]);
  });
});
