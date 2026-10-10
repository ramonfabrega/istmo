// Public snapshots only. Browsers remain no-store; this cache is local to each edge.
export const PUBLIC_TTL_MS = 5000;
type Snapshot = { body: string; at: number; loadMs: number };
type Pending = { at: number; promise: Promise<Snapshot> };
const pending = new Map<string, Pending>();
const writes = new Map<string, Promise<void>>();
export async function publicSnapshot(
  key: string,
  cache: Pick<Cache, "match" | "put">,
  load: (at: number) => Promise<unknown>,
  after = 0,
) {
  const started = performance.now();
  const respond = (snapshot: Snapshot, state: string) => {
    const durationMs = Math.round((performance.now() - started) * 10) / 10;
    const snapshotAgeMs = Math.max(0, Date.now() - snapshot.at);
    console.info(
      JSON.stringify({
        event: "public_snapshot",
        path: new URL(key).pathname,
        cache: state,
        durationMs,
        snapshotAgeMs,
        loadMs: snapshot.loadMs,
      }),
    );
    return new Response(snapshot.body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Snapshot-At": String(snapshot.at),
        "X-Istmo-Cache": state,
        "Server-Timing": `app;dur=${durationMs}, snapshot_age;dur=${snapshotAgeMs}, load;dur=${snapshot.loadMs}`,
      },
    });
  };
  const cached = await cache.match(key).catch(() => undefined);
  const at = Number(cached?.headers.get("X-Snapshot-At"));
  if (cached && at > after && Date.now() - at < PUBLIC_TTL_MS) {
    return respond({ body: await cached.text(), at, loadMs: 0 }, "HIT");
  }
  let job = pending.get(key);
  if (job && job.at <= after) job = undefined;
  const shared = !!job;
  if (!job) {
    const at = Date.now();
    const loadStarted = performance.now();
    let work!: Promise<Snapshot>;
    work = (async () => {
      const body = JSON.stringify(await load(at));
      const snapshot = {
        body,
        at,
        loadMs: Math.round((performance.now() - loadStarted) * 10) / 10,
      };
      // An invalidated older query must not overwrite its replacement's cache.
      if (
        pending.get(key)?.promise === work &&
        Date.now() - at < PUBLIC_TTL_MS
      ) {
        const write = (writes.get(key) ?? Promise.resolve()).then(async () => {
          if (pending.get(key)?.promise !== work) return;
          await cache
            .put(
              key,
              new Response(body, {
                headers: {
                  "Content-Type": "application/json",
                  "Cache-Control": "public, max-age=5",
                  "X-Snapshot-At": String(at),
                },
              }),
            )
            .catch(() => {});
        });
        writes.set(key, write);
        try {
          await write;
        } finally {
          if (writes.get(key) === write) writes.delete(key);
        }
      }
      return snapshot;
    })();
    job = { at, promise: work };
    pending.set(key, job);
  }
  try {
    return respond(await job.promise, shared ? "COALESCED" : "MISS");
  } finally {
    if (pending.get(key) === job) pending.delete(key);
  }
}
