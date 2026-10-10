import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
const script = readFileSync("public/sw.js", "utf8");

function worker({ offline = false, showFails = false } = {}) {
  const handlers = new Map<string, (event: any) => void>();
  const postMessage = vi.fn();
  const showNotification = vi.fn(async () => {
    if (showFails) throw new Error("display failed");
  });
  const fetch = vi.fn(async () => {
    if (offline) throw new Error("offline");
    return new Response(null, { status: 204 });
  });
  runInNewContext(script, {
    self: {
      addEventListener: (name: string, handler: (event: any) => void) =>
        handlers.set(name, handler),
      registration: { showNotification },
      clients: { matchAll: async () => [{ postMessage }] },
      navigator: {
        userAgent: "Mozilla/5.0 (iPhone) Safari/604",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
    },
    fetch,
    Date,
    AbortSignal,
  });
  return {
    showNotification,
    fetch,
    postMessage,
    async push(data: object) {
      let work!: Promise<void>;
      handlers.get("push")!({
        data: { json: () => data },
        waitUntil: (value: Promise<void>) => {
          work = value;
        },
      });
      await work;
    },
  };
}
it("displays first, then acknowledges receipt and refreshes open clients without leaking the receipt token to them", async () => {
  const w = worker();
  await w.push({ title: "Test", delivery: { id: "job", token: "secret" } });
  expect(w.showNotification).toHaveBeenCalledOnce();
  expect(w.fetch).toHaveBeenCalledOnce();
  expect(w.showNotification.mock.invocationCallOrder[0]).toBeLessThan(
    w.fetch.mock.invocationCallOrder[0],
  );
  const [url, options] = w.fetch.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("/api/push/receipt");
  expect(JSON.parse(String(options.body))).toMatchObject({
    id: "job",
    token: "secret",
    deviceKind: "ios",
    receivedAt: expect.any(Number),
    shownAt: expect.any(Number),
  });
  expect(w.postMessage).toHaveBeenCalledWith({
    type: "istmo:report",
    after: 0,
  });
  expect(JSON.stringify(w.showNotification.mock.calls)).not.toContain("secret");
});
it("does not lose notifications when the receipt callback is offline, and supports old payloads", async () => {
  const w = worker({ offline: true });
  await expect(
    w.push({ delivery: { id: "job", token: "secret" } }),
  ).resolves.toBeUndefined();
  expect(w.showNotification).toHaveBeenCalledOnce();
  const legacy = worker();
  await legacy.push({ title: "Old payload" });
  expect(legacy.showNotification).toHaveBeenCalledOnce();
  expect(legacy.fetch).not.toHaveBeenCalled();
});
it("records receipt without claiming successful notification display when showing fails", async () => {
  const w = worker({ showFails: true });
  await expect(
    w.push({ delivery: { id: "job", token: "secret" } }),
  ).rejects.toThrow("display failed");
  const [, options] = w.fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(options.body)).shownAt).toBeNull();
});
