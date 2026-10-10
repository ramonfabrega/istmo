import { Hono } from "hono";
import {
  buildPushPayload,
  type PushSubscription,
} from "@block65/webcrypto-web-push";
import type { Env } from "./env";
import type { ParsedReport } from "./parsers";
import { digest } from "./crypto";
export function validSubscription(s: unknown): s is PushSubscription {
  try {
    const v = s as PushSubscription;
    const u = new URL(v.endpoint);
    return (
      u.protocol === "https:" &&
      !u.port &&
      !u.username &&
      !u.password &&
      (u.hostname === "fcm.googleapis.com" ||
        u.hostname === "web.push.apple.com" ||
        u.hostname === "updates.push.services.mozilla.com" ||
        u.hostname.endsWith(".notify.windows.com")) &&
      /^[\w-]{80,100}$/.test(v.keys.p256dh) &&
      /^[\w-]{20,30}$/.test(v.keys.auth)
    );
  } catch {
    return false;
  }
}
export async function enqueueReport(
  env: Env,
  report: ParsedReport,
  id: string,
) {
  if (
    report.occurred_at < Date.now() - 15 * 60000 ||
    report.occurred_at > Date.now() + 60000
  )
    return;
  const subs = await env.DB.prepare(
    "SELECT id FROM push_subscriptions WHERE source=? AND min_magnitude<=?",
  )
    .bind(report.source, report.magnitude)
    .all<{ id: string }>();
  if (
    report.latitude < 5 ||
    report.latitude > 11 ||
    report.longitude < -84 ||
    report.longitude > -76
  )
    return;
  for (const sub of subs.results) {
    const now = Date.now();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO push_outbox(id,subscription_id,payload,next_attempt,expires_at) VALUES(?,?,?,?,?)",
    )
      .bind(
        `${sub.id}:${id}`,
        sub.id,
        JSON.stringify({
          title: `${report.source.toUpperCase()} · M ${report.magnitude.toFixed(1)}`,
          body: report.place,
          tag: id,
          url: "/",
        }),
        now,
        now + 15 * 60000,
      )
      .run();
  }
}
export async function drainPush(env: Env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT)
    return;
  await env.DB.prepare(
    "UPDATE push_outbox SET status='expired' WHERE status='pending' AND expires_at<?",
  )
    .bind(Date.now())
    .run();
  const jobs = await env.DB.prepare(
    "SELECT o.*,s.subscription FROM push_outbox o JOIN push_subscriptions s ON o.subscription_id=s.id WHERE o.status='pending' AND o.next_attempt<=? LIMIT 25",
  )
    .bind(Date.now())
    .all<{
      id: string;
      subscription_id: string;
      subscription: string;
      payload: string;
      attempts: number;
    }>();
  for (const job of jobs.results) {
    try {
      const subscription = JSON.parse(job.subscription) as PushSubscription;
      if (!validSubscription(subscription))
        throw new Error("Invalid subscription endpoint");
      const payload = await buildPushPayload(
        { data: job.payload, options: { ttl: 300 } },
        subscription,
        {
          subject: env.VAPID_SUBJECT,
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
        },
      );
      const res = await fetch(subscription.endpoint, {
        ...payload,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 404 || res.status === 410) {
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM push_outbox WHERE subscription_id=?",
          ).bind(job.subscription_id),
          env.DB.prepare("DELETE FROM push_subscriptions WHERE id=?").bind(
            job.subscription_id,
          ),
        ]);
        continue;
      }
      if (!res.ok) throw new Error(`Push service ${res.status}`);
      await env.DB.prepare(
        "UPDATE push_outbox SET status='accepted',attempts=attempts+1,last_error=NULL WHERE id=?",
      )
        .bind(job.id)
        .run();
    } catch (e) {
      await env.DB.prepare(
        "UPDATE push_outbox SET attempts=attempts+1,next_attempt=?,last_error=? WHERE id=?",
      )
        .bind(
          Date.now() + Math.min(300000, 30000 * 2 ** job.attempts),
          String(e),
          job.id,
        )
        .run();
    }
  }
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
    "INSERT INTO push_subscriptions(id,subscription,token_hash,source,min_magnitude,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,source=excluded.source,min_magnitude=excluded.min_magnitude",
  )
    .bind(
      id,
      JSON.stringify(b.subscription),
      await digest(token),
      b.source,
      b.minMagnitude,
      Date.now(),
    )
    .run();
  return c.json({ id, token });
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
  if (!sub) return c.json({ error: "Subscription not found" }, 404);
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
    "SELECT id FROM push_subscriptions WHERE id=? AND token_hash=?",
  )
    .bind(b.id, await digest(b.token))
    .first();
  if (!sub) return c.json({ error: "Subscription not found" }, 404);
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO push_outbox(id,subscription_id,payload,next_attempt,expires_at) VALUES(?,?,?,?,?)",
  )
    .bind(
      `test:${b.id}:${Math.floor(Date.now() / 60000)}`,
      b.id,
      JSON.stringify({
        title: "Istmo is connected",
        body: "This is a test notification. No earthquake is associated with it.",
        tag: "istmo-test",
        url: "/",
      }),
      Date.now(),
      Date.now() + 300000,
    )
    .run();
  await drainPush(c.env);
  return c.json({ queued: true });
});
export default app;
