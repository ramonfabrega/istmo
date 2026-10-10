import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
import { subscribeReports, DEFAULT_REPORT_QUERY } from "../src/report-feed";
let doc: EventTarget & { hidden: boolean };
let win: EventTarget;
let serviceWorker: EventTarget;
beforeEach(() => {
  vi.useFakeTimers();
  api.mockReset();
  doc = Object.assign(new EventTarget(), { hidden: false });
  win = new EventTarget();
  serviceWorker = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { serviceWorker });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const snapshot = (at: number) => ({
  reports: [],
  sources: [],
  generatedAt: at,
});
it("carries push freshness through an in-flight request and shares the follow-up across map and sound", async () => {
  let resolve!: (value: unknown) => void;
  api
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue(snapshot(200));
  const map = vi.fn();
  const sound = vi.fn();
  const off = subscribeReports(DEFAULT_REPORT_QUERY, map, vi.fn());
  const offSound = subscribeReports(DEFAULT_REPORT_QUERY, sound, vi.fn(), true);
  try {
    serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "istmo:report", after: 150 },
      }),
    );
    resolve(snapshot(100));
    await vi.advanceTimersByTimeAsync(0);
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls[1][0]).toContain("after=150");
    expect(map.mock.calls).toEqual([[snapshot(200)]]);
    expect(sound.mock.calls).toEqual([[snapshot(200)]]);
  } finally {
    off();
    offSound();
  }
});
it("refreshes on Dock-style focus without a visibility change, then removes wake listeners", async () => {
  api.mockResolvedValue(snapshot(200));
  const off = subscribeReports(DEFAULT_REPORT_QUERY, vi.fn(), vi.fn());
  try {
    await vi.advanceTimersByTimeAsync(0);
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls[1][0]).toContain("fresh=1");
    doc.hidden = true;
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(api).toHaveBeenCalledTimes(2);
  } finally {
    off();
  }
  doc.hidden = false;
  win.dispatchEvent(new Event("focus"));
  serviceWorker.dispatchEvent(
    new MessageEvent("message", { data: { type: "istmo:report" } }),
  );
  await vi.advanceTimersByTimeAsync(30000);
  expect(api).toHaveBeenCalledTimes(2);
});
