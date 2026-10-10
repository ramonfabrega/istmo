import { afterEach, expect, it, vi } from "vitest";
import { publicSnapshot, PUBLIC_TTL_MS } from "../worker/public-cache";
function memoryCache() {
  const entries = new Map<string, Response>();
  return {
    match: vi.fn(async (key: RequestInfo | URL) =>
      entries.get(String(key))?.clone(),
    ),
    put: vi.fn(async (key: RequestInfo | URL, response: Response) => {
      entries.set(String(key), response.clone());
    }),
  };
}
afterEach(() => vi.useRealTimers());
it("shares concurrent misses and serves bounded-age snapshots without browser caching", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const cache = memoryCache();
  let release!: (value: unknown) => void;
  const load = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const requests = Array.from({ length: 100 }, () =>
    publicSnapshot("https://test/reports", cache, load),
  );
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  release({ reports: ["original"] });
  const responses = await Promise.all(requests);
  expect(
    responses.filter((r) => r.headers.get("X-Istmo-Cache") === "MISS"),
  ).toHaveLength(1);
  expect(
    responses.filter((r) => r.headers.get("X-Istmo-Cache") === "COALESCED"),
  ).toHaveLength(99);
  const snapshotAt = Number(responses[0].headers.get("X-Snapshot-At"));
  vi.setSystemTime(snapshotAt + PUBLIC_TTL_MS - 1);
  const hit = await publicSnapshot("https://test/reports", cache, load);
  expect(hit.headers.get("Cache-Control")).toBe("no-store");
  expect(hit.headers.get("X-Istmo-Cache")).toBe("HIT");
  const update = vi.fn(async () => ({ reports: ["revised"] }));
  vi.setSystemTime(snapshotAt + PUBLIC_TTL_MS);
  expect(
    await (await publicSnapshot("https://test/reports", cache, update)).json(),
  ).toEqual({ reports: ["revised"] });
  expect(update).toHaveBeenCalledOnce();
});
it("never caches failures or serves expired data on a failed refresh", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const cache = memoryCache();
  await publicSnapshot("https://test/error", cache, async () => ({
    old: true,
  }));
  vi.setSystemTime(110000);
  await expect(
    publicSnapshot("https://test/error", cache, async () => {
      throw new Error("DB unavailable");
    }),
  ).rejects.toThrow("DB unavailable");
  expect(
    await (
      await publicSnapshot("https://test/error", cache, async () => ({
        recovered: true,
      }))
    ).json(),
  ).toEqual({ recovered: true });
});
it("keeps different query snapshots separate", async () => {
  const cache = memoryCache();
  for (const scope of ["panama", "world"]) {
    const response = await publicSnapshot(
      `https://test/?scope=${scope}`,
      cache,
      async () => ({ scope }),
    );
    expect(await response.json()).toEqual({ scope });
  }
});
