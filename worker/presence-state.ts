export const VIEWER_WINDOW_MS = 90000;
export class PresenceState {
  private viewers = new Map<string, number>();
  readonly startedAt: number;
  constructor(
    private capacity = 20000,
    now = Date.now(),
  ) {
    this.startedAt = now;
  }
  private prune(now: number) {
    // Refreshing a session moves it to the end, so expiry work is amortized.
    for (const [id, seen] of this.viewers) {
      if (now - seen < VIEWER_WINDOW_MS) break;
      this.viewers.delete(id);
    }
  }
  touch(id: string, now = Date.now()) {
    this.prune(now);
    if (!this.viewers.has(id) && this.viewers.size >= this.capacity)
      return false;
    this.viewers.delete(id);
    this.viewers.set(id, now);
    return true;
  }
  count(now = Date.now()) {
    this.prune(now);
    return {
      active: this.viewers.size,
      windowSeconds: VIEWER_WINDOW_MS / 1000,
      approximate: true,
      startedAt: this.startedAt,
      capacity: this.capacity,
    };
  }
}
