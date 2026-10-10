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

it("bypasses a snapshot and in-flight query older than a push freshness hint", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const cache = memoryCache();
  const key = "https://test/freshness";
  await publicSnapshot(key, cache, async () => ({ value: 0 }));
  vi.setSystemTime(100002);
  const updated = await publicSnapshot(
    key,
    cache,
    async () => ({ value: 1 }),
    100001,
  );
  expect(await updated.json()).toEqual({ value: 1 });
  vi.setSystemTime(110000);
  let release!: (v: unknown) => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const older = publicSnapshot(
    key,
    cache,
    () =>
      new Promise((resolve) => {
        release = resolve;
        started();
      }),
  );
  await began;
  vi.setSystemTime(110002);
  const fresh = await publicSnapshot(
    key,
    cache,
    async () => ({ value: 2 }),
    110001,
  );
  expect(await fresh.json()).toEqual({ value: 2 });
  release({ value: 1 });
  await older;
  const next = await publicSnapshot(key, cache, async () => ({ value: 99 }));
  expect(await next.json()).toEqual({ value: 2 });
});

it("does not let an already-started old cache write replace the fresh snapshot", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(200000);
  const cache = memoryCache();
  const originalPut = cache.put;
  let release!: () => void;
  let entered!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delayed = {
    ...cache,
    put: async (key: RequestInfo | URL, response: Response) => {
      if (response.headers.get("X-Snapshot-At") === "200000") {
        entered();
        await hold;
      }
      return originalPut(key, response);
    },
  };
  const old = publicSnapshot("https://test/write-race", delayed, async () => ({
    value: 0,
  }));
  await writing;
  vi.setSystemTime(200002);
  let loaded!: () => void;
  const loadedNew = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  const fresh = publicSnapshot(
    "https://test/write-race",
    delayed,
    async () => {
      loaded();
      return { value: 1 };
    },
    200001,
  );
  await loadedNew;
  // Let the new query reach its cache write before releasing the old write.
  await Promise.resolve();
  await Promise.resolve();
  release();
  await Promise.all([old, fresh]);
  expect(
    await (
      await publicSnapshot("https://test/write-race", cache, async () => ({
        value: 99,
      }))
    ).json(),
  ).toEqual({ value: 1 });
});
