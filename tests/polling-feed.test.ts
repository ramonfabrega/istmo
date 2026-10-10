import { afterEach, expect, it, vi } from "vitest";
import { PollingFeed } from "../shared/polling-feed";
afterEach(() => vi.useRealTimers());
it("shares one timer and request, pauses hidden viewers, and lets sound continue", async () => {
  vi.useFakeTimers();
  let visible = true;
  const load = vi.fn(async () => ({ value: 1 }));
  const feed = new PollingFeed(load, () => visible);
  const map = vi.fn();
  const sound = vi.fn();
  const offMap = feed.subscribe(map, vi.fn());
  const offSound = feed.subscribe(sound, vi.fn(), true);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  expect(map).toHaveBeenCalledTimes(1);
  expect(sound).toHaveBeenCalledTimes(1);
  visible = false;
  await vi.advanceTimersByTimeAsync(15000);
  expect(load).toHaveBeenCalledTimes(2);
  offSound();
  await vi.advanceTimersByTimeAsync(30000);
  expect(load).toHaveBeenCalledTimes(2);
  visible = true;
  await feed.refresh();
  expect(load).toHaveBeenCalledTimes(3);
  offMap();
  await vi.advanceTimersByTimeAsync(30000);
  expect(load).toHaveBeenCalledTimes(3);
});
it("does not deliver a superseded filter request after unsubscribe and retries errors", async () => {
  let resolve!: (n: number) => void;
  const load = vi.fn(
    () =>
      new Promise<number>((r) => {
        resolve = r;
      }),
  );
  const feed = new PollingFeed(load, () => true);
  const data = vi.fn();
  const off = feed.subscribe(data, vi.fn());
  off();
  resolve(1);
  await feed.refresh();
  expect(data).not.toHaveBeenCalled();
  const failed = new PollingFeed(
    vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(2),
    () => true,
  );
  await expect(failed.refresh()).rejects.toThrow("offline");
  await expect(failed.refresh()).resolves.toBe(2);
});
