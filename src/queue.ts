/**
 * Sliding-window rate-limit queue.
 *
 * Allows at most `size` calls within any `window`-second interval.
 * Callers await `acquire()` before making an API request; the queue
 * delays them as needed so the window constraint is never exceeded.
 *
 * The internal timestamp array is bounded to at most `size` entries:
 * expired entries are trimmed at the start of every acquire() call and
 * by a periodic external trim() call, so there is no memory leak.
 */
export class Queue {
  private readonly size: number;
  private readonly windowMs: number;
  private readonly timestamps: number[] = [];
  private pauseUntil = 0;

  /**
   * @param size   Maximum number of requests allowed in the time window.
   * @param window Time window in seconds.
   */
  constructor(size: number, window: number) {
    this.size     = size;
    this.windowMs = window * 1000;
  }

  /**
   * Acquire a slot.  Resolves when it is safe to make the next request
   * without exceeding the configured rate limit.
   */
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();

      // Honour an active pause (triggered by a 429 response).
      if (now < this.pauseUntil) {
        await new Promise<void>(r => setTimeout(r, this.pauseUntil - now));
        continue;
      }

      // Release timestamps that have fallen outside the current window.
      // This keeps the array bounded to at most `size` entries.
      const cutoff = now - this.windowMs;
      while (this.timestamps.length && this.timestamps[0]! <= cutoff) {
        this.timestamps.shift();
      }

      // Slot available — record the call and return.
      if (this.timestamps.length < this.size) {
        this.timestamps.push(now);
        return;
      }

      // Window full — wait until the oldest recorded call expires, then retry.
      const waitMs = this.timestamps[0]! + this.windowMs - now + 1;
      await new Promise<void>(r => setTimeout(r, waitMs));
    }
  }

  /**
   * Pause the queue for `durationMs` milliseconds.
   * Called when a 429 Too Many Requests response is received.
   */
  pause(durationMs: number): void {
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + durationMs);
  }

  /**
   * Explicitly release expired timestamps.
   * acquire() already trims on every call, but trim() lets external code
   * (e.g. a setInterval) keep the array clean during idle periods.
   */
  trim(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length && this.timestamps[0]! <= cutoff) {
      this.timestamps.shift();
    }
  }
}
