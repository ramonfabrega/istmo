import { Hono } from "hono";
import receipts from "./push-receipts";
import { drainPush, validSubscription } from "./push-delivery";
export { drainPush, validSubscription } from "./push-delivery";
import type { Env } from "./env";
import type { ParsedReport } from "./parsers";
import { digest } from "./crypto";
/** Join the collector's transaction: either both report and notification jobs
 * commit, or the next poll can retry both. Fan-out is one SQL statement. */
export function reportNotification(
  env: Env,
  report: ParsedReport,
  id: string,
  now: number,
): D1PreparedStatement | null {
  if (
    report.occurred_at < now - 15 * 60000 ||
    report.occurred_at > now + 60000 ||
    report.latitude < 5 ||
    report.latitude > 11 ||
    report.longitude < -84 ||
    report.longitude > -76
  )
    return null;
  const title = ` · ${report.source.toUpperCase()} · M ${report.magnitude.toFixed(1)}`;
  return env.DB.prepare(
    `
    INSERT OR IGNORE INTO push_outbox(id,subscription_id,payload,next_attempt,expires_at,queued_at)
    SELECT id || ':' || ?, id,
      json_object('title',(CASE WHEN locale='es' THEN 'Nuevo reporte' ELSE 'New report' END) || ?,
        'body',?,'tag',?,'url','/'), ?, ?, ?
    FROM push_subscriptions WHERE source=? AND min_magnitude<=?
  `,
  ).bind(
    id,
    title,
    report.place,
    id,
    now,
    now + 15 * 60000,
    now,
    report.source,
    report.magnitude,
  );
}
const app = new Hono<{ Bindings: Env }>();
app.get("/config", (c) =>
  c.json({ publicKey: c.env.VAPID_PUBLIC_KEY || null }),
);
app.post("/subscribe", async (c) => {
  const b = await c.req.json();
  if (
    !validSubscription(b.subscription) ||
    !["up", "usgs"].includes(b.source) ||
    !Number.isFinite(b.minMagnitude) ||
    b.minMagnitude < 0 ||
    b.minMagnitude > 10
  )
    return c.json({ error: "Invalid notification settings" }, 400);
  const id = await digest(b.subscription.endpoint);
  const existing = await c.env.DB.prepare(
    "SELECT token_hash FROM push_subscriptions WHERE id=?",
  )
    .bind(id)
    .first<{ token_hash: string }>();
  let token = b.token;
  if (existing && (!token || existing.token_hash !== (await digest(token))))
    return c.json(
      { error: "Device token required to change this subscription" },
      403,
    );
  if (!existing) token = crypto.randomUUID() + crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO push_subscriptions(id,subscription,token_hash,source,min_magnitude,created_at,locale) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,source=excluded.source,min_magnitude=excluded.min_magnitude,locale=excluded.locale",
  )
    .bind(
      id,
      JSON.stringify(b.subscription),
      await digest(token),
      b.source,
      b.minMagnitude,
      Date.now(),
      b.locale === "es" ? "es" : "en",
    )
    .run();
  return c.json({ id, token });
});
app.post("/locale", async (c) => {
  const b = await c.req.json();
  if (
    typeof b.id !== "string" ||
    typeof b.token !== "string" ||
    !["en", "es"].includes(b.locale)
  )
    return c.json({ error: "Invalid notification settings" }, 400);
  await c.env.DB.prepare(
    "UPDATE push_subscriptions SET locale=? WHERE id=? AND token_hash=?",
  )
    .bind(b.locale, b.id, await digest(b.token))
    .run();
  return c.json({ ok: true });
});
app.post("/unsubscribe", async (c) => {
  const b = await c.req.json();
  if (typeof b.id !== "string" || typeof b.token !== "string")
    return c.json({ error: "Device credentials required" }, 400);
  const sub = await c.env.DB.prepare(
    "SELECT id FROM push_subscriptions WHERE id=? AND token_hash=?",
  )
    .bind(b.id, await digest(b.token))
    .first();
  if (!sub) return c.json({ ok: true });
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM push_outbox WHERE subscription_id=?").bind(
      b.id,
    ),
    c.env.DB.prepare("DELETE FROM push_subscriptions WHERE id=?").bind(b.id),
  ]);
  return c.json({ ok: true });
});
app.post("/test", async (c) => {
  const b = await c.req.json();
  if (typeof b.id !== "string" || typeof b.token !== "string")
    return c.json({ error: "Device credentials required" }, 400);
  const sub = await c.env.DB.prepare(
    "SELECT id,locale FROM push_subscriptions WHERE id=? AND token_hash=?",
  )
    .bind(b.id, await digest(b.token))
    .first<{ id: string; locale: string }>();
  if (!sub) return c.json({ error: "Subscription not found" }, 404);
  const jobId = `test:${b.id}:${Math.floor(Date.now() / 60000)}`;
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO push_outbox(id,subscription_id,payload,next_attempt,expires_at,queued_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      jobId,
      b.id,
      JSON.stringify({
        title:
          sub.locale === "es" ? "Istmo está conectado" : "Istmo is connected",
        body:
          sub.locale === "es"
            ? "Esta es una notificación de prueba. No está asociada a ningún sismo."
            : "This is a test notification. No earthquake is associated with it.",
        tag: "istmo-test",
        url: "/",
      }),
      Date.now(),
      Date.now() + 300000,
      Date.now(),
    )
    .run();
  await drainPush(c.env, jobId);
  const result = await c.env.DB.prepare(
    "SELECT status,last_error FROM push_outbox WHERE id=?",
  )
    .bind(jobId)
    .first<{ status: string; last_error: string | null }>();
  if (!result)
    return c.json(
      {
        error:
          "This push subscription expired. Turn notifications off and on to reconnect.",
      },
      410,
    );
  if (result.last_error)
    return c.json({ error: `Delivery failed: ${result.last_error}` }, 502);
  if (result.status !== "accepted")
    return c.json(
      {
        error:
          "Push delivery is not configured or is still pending. Please try again shortly.",
      },
      503,
    );
  return c.json({ accepted: true });
});
app.route("/", receipts);
export default app;
