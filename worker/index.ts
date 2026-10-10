import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "./env";
import family from "./family";
import push from "./push";
import { collect } from "./collect";
import { digest } from "./crypto";
export { StationRelay } from "./relay";
const app = new Hono<{ Bindings: Env }>();
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 2 * 1024 * 1024,
    onError: (c) => c.json({ error: "Request too large" }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  const url = new URL(c.req.url);
  if (
    origin &&
    origin !== url.origin &&
    !(c.env.APP_ENV === "local" && new URL(origin).host === url.host)
  )
    return c.json({ error: "Cross-origin request rejected" }, 403);
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});
app.use("/api/*", async (c, next) => {
  if (c.env.APP_ENV !== "production") return next();
  const limiter = ["GET", "HEAD"].includes(c.req.method)
    ? c.env.API_READ_LIMIT
    : c.env.API_WRITE_LIMIT;
  if (!limiter)
    return c.json({ error: "Service temporarily unavailable" }, 503);
  const { success } = await limiter.limit({
    key: c.req.header("CF-Connecting-IP") || "unknown",
  });
  if (!success) {
    c.header("Retry-After", "60");
    return c.json({ error: "Too many requests. Try again in a minute." }, 429);
  }
  return next();
});
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Request failed. Check server logs." }, 500);
});
app.get("/api/health", (c) =>
  c.json({ ok: true, environment: c.env.APP_ENV, time: Date.now() }),
);
app.get("/api/reports", async (c) => {
  const hours = Math.min(168, Math.max(1, Number(c.req.query("hours")) || 24));
  const mag = Math.max(-2, Math.min(10, Number(c.req.query("magnitude")) || 0));
  const scope = c.req.query("scope");
  const args: unknown[] = [Date.now() - hours * 3600000, mag];
  let query =
    "SELECT * FROM reports WHERE withdrawn_at IS NULL AND occurred_at>=? AND magnitude>=?";
  if (scope !== "world")
    query += " AND latitude BETWEEN 5 AND 11 AND longitude BETWEEN -84 AND -76";
  query += " ORDER BY occurred_at DESC LIMIT 1000";
  return c.json({
    reports: (
      await c.env.DB.prepare(query)
        .bind(...args)
        .all()
    ).results,
    sources: (await c.env.DB.prepare("SELECT * FROM sources").all()).results,
  });
});
app.get("/api/reports/:id/revisions", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT revision,observed_at,payload FROM report_revisions WHERE report_id=? ORDER BY revision DESC",
      )
        .bind(c.req.param("id"))
        .all()
    ).results,
  ),
);
app.get("/api/stations", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,name,latitude,longitude,mode,description,last_received,last_sample FROM stations",
      ).all()
    ).results,
  ),
);
app.get("/api/stations/:id/stream", async (c) => {
  const station = await c.env.DB.prepare("SELECT id FROM stations WHERE id=?")
    .bind(c.req.param("id"))
    .first();
  if (!station) return c.json({ error: "Unknown station" }, 404);
  return c.env.STATIONS.get(c.env.STATIONS.idFromName(c.req.param("id"))).fetch(
    c.req.raw,
  );
});
app.post("/api/stations/:id/records", async (c) => {
  const stationId = c.req.param("id");
  const auth = c.req.header("Authorization")?.replace(/^Bearer /, "");
  const credentials = await c.env.DB.prepare(
    "SELECT token_hash FROM stations WHERE id=?",
  )
    .bind(stationId)
    .first<{ token_hash: string | null }>();
  const valid =
    credentials &&
    auth &&
    (credentials.token_hash
      ? (await digest(auth)) === credentials.token_hash
      : stationId === "replay-panama" && auth === c.env.INGEST_TOKEN);
  if (!valid) return c.json({ error: "Station authentication required" }, 401);
  const url = new URL(c.req.url);
  url.searchParams.set("station", c.req.param("id"));
  return c.env.STATIONS.get(c.env.STATIONS.idFromName(c.req.param("id"))).fetch(
    new Request(url, c.req.raw),
  );
});
app.post("/api/admin/stations", async (c) => {
  if (
    !c.env.ADMIN_TOKEN ||
    c.req.header("Authorization") !== `Bearer ${c.env.ADMIN_TOKEN}`
  )
    return c.json({ error: "Admin authentication required" }, 401);
  const b = await c.req.json();
  if (
    typeof b.id !== "string" ||
    !/^[a-z0-9-]{3,60}$/.test(b.id) ||
    typeof b.name !== "string" ||
    !b.name.trim() ||
    !Number.isFinite(b.latitude) ||
    Math.abs(b.latitude) > 90 ||
    !Number.isFinite(b.longitude) ||
    Math.abs(b.longitude) > 180 ||
    !["live", "replay"].includes(b.mode)
  )
    return c.json({ error: "Invalid station metadata" }, 400);
  if (
    await c.env.DB.prepare("SELECT id FROM stations WHERE id=?")
      .bind(b.id)
      .first()
  )
    return c.json({ error: "Station already exists" }, 409);
  const token = crypto.randomUUID() + crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO stations(id,name,latitude,longitude,mode,description,token_hash) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      b.id,
      b.name.slice(0, 100),
      b.latitude,
      b.longitude,
      b.mode,
      String(b.description || "").slice(0, 500),
      await digest(token),
    )
    .run();
  return c.json({ id: b.id, token }, 201);
});
app.get("/api/stations/:id/archive", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,start_time,original_start,sample_rate,sample_count,channel,bytes,received_at FROM waveform_records WHERE station_id=? ORDER BY received_at DESC LIMIT 100",
      )
        .bind(c.req.param("id"))
        .all()
    ).results,
  ),
);
app.get("/api/records/:id", async (c) => {
  const item = await c.env.DB.prepare(
    "SELECT object_key FROM waveform_records WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first<{ object_key: string }>();
  if (!item) return c.notFound();
  const object = await c.env.ARCHIVE.get(item.object_key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/vnd.fdsn.mseed",
      "Content-Disposition": 'attachment; filename="record.mseed"',
    },
  });
});
app.post("/api/admin/collect", async (c) => {
  if (
    !c.env.ADMIN_TOKEN ||
    c.req.header("Authorization") !== `Bearer ${c.env.ADMIN_TOKEN}`
  )
    return c.json({ error: "Admin authentication required" }, 401);
  const body = await c.req.json<{ source?: string; raw?: string }>();
  if (!["up", "usgs"].includes(body.source || ""))
    return c.json({ error: "Unknown source" }, 400);
  if (body.raw && c.env.APP_ENV !== "local")
    return c.json({ error: "Raw imports are local-only" }, 403);
  const result = await collect(c.env, body.source as "up" | "usgs", body.raw);
  return c.json(result, "error" in result ? 502 : 200);
});
app.route("/api/family", family);
app.route("/api/push", push);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        for (const source of ["up", "usgs"] as const)
          await collect(env, source);
      })(),
    );
  },
};
