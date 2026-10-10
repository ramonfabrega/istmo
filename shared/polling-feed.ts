// One request/timer per query, shared by the map and sound subscribers.
export class PollingFeed<T> {
  private listeners = new Set<{
    data: (value: T) => void;
    error: (error: unknown) => void;
    background: boolean;
  }>();
  private pending: Promise<T> | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private latest?: T;
  private invalidated = false;
  constructor(
    private load: () => Promise<T>,
    private visible: () => boolean,
    private interval = 15000,
  ) {}
  get size() {
    return this.listeners.size;
  }
  subscribe(
    data: (value: T) => void,
    error: (error: unknown) => void,
    background = false,
  ) {
    const listener = { data, error, background };
    this.listeners.add(listener);
    if (this.latest !== undefined) data(this.latest);
    if (!this.timer) {
      const poll = () => {
        if (this.visible() || [...this.listeners].some((l) => l.background))
          void this.refresh().catch(() => {});
      };
      this.timer = setInterval(poll, this.interval);
      poll();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }
  refresh(fresh = false): Promise<T> {
    if (fresh) this.invalidated = true;
    if (this.pending) return this.pending;
    this.pending = this.loadLatest().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  private async loadLatest(): Promise<T> {
    for (;;) {
      this.invalidated = false;
      let value: T;
      try {
        value = await this.load();
      } catch (error) {
        if (this.invalidated) continue;
        this.listeners.forEach((listener) => listener.error(error));
        throw error;
      }
      // A push/resume arriving during a request invalidates its result. Share
      // one immediate follow-up instead of waiting another polling interval.
      if (this.invalidated) continue;
      this.latest = value;
      this.listeners.forEach((listener) => listener.data(value));
      return value;
    }
  }
}
