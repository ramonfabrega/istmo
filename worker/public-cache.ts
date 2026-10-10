// Public snapshots only. Browsers remain no-store; this cache is local to each edge.
export const PUBLIC_TTL_MS = 5000;
type Snapshot = { body: string; at: number };
const pending = new Map<string, Promise<Snapshot>>();
export async function publicSnapshot(
  key: string,
  cache: Pick<Cache, "match" | "put">,
  load: (at: number) => Promise<unknown>,
) {
  const cached = await cache.match(key).catch(() => undefined);
  const at = Number(cached?.headers.get("X-Snapshot-At"));
  if (cached && at > 0 && Date.now() - at < PUBLIC_TTL_MS) {
    return respond({ body: await cached.text(), at }, "HIT");
  }
  let job = pending.get(key);
  const shared = !!job;
  if (!job) {
    job = (async () => {
      const at = Date.now();
      const snapshot = { body: JSON.stringify(await load(at)), at };
      // Slow loads aren't given another full TTL after completing.
      if (Date.now() - at < PUBLIC_TTL_MS) {
        const response = respond(snapshot, "HIT");
        response.headers.set("Cache-Control", "public, max-age=5");
        await cache.put(key, response).catch(() => {});
      }
      return snapshot;
    })();
    pending.set(key, job);
  }
  try {
    return respond(await job, shared ? "COALESCED" : "MISS");
  } finally {
    if (pending.get(key) === job) pending.delete(key);
  }
}
function respond(snapshot: Snapshot, state: string) {
  return new Response(snapshot.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Snapshot-At": String(snapshot.at),
      "X-Istmo-Cache": state,
    },
  });
}
