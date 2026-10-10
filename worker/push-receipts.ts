import { Hono } from "hono";
import type { Env } from "./env";
const app = new Hono<{ Bindings: Env }>();

// Each encrypted push carries a random, job-specific receipt capability. It
// cannot change subscriptions, acknowledge another job, or read delivery data.
app.post("/receipt", async (c) => {
  const b = await c.req.json();
  const timestamp = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (
    typeof b.id !== "string" ||
    b.id.length > 200 ||
    typeof b.token !== "string" ||
    b.token.length !== 72 ||
    !timestamp(b.receivedAt) ||
    (b.shownAt !== null &&
      (!timestamp(b.shownAt) || b.shownAt < b.receivedAt)) ||
    !["ios", "mac", "android", "windows", "other"].includes(b.deviceKind)
  )
    return c.json({ error: "Invalid receipt" }, 400);
  await c.env.DB.prepare(
    "UPDATE push_outbox SET receipt_at=?,device_received_at=?,device_shown_at=?,device_kind=? WHERE id=? AND receipt_token=? AND receipt_at IS NULL",
  )
    .bind(Date.now(), b.receivedAt, b.shownAt, b.deviceKind, b.id, b.token)
    .run();
  // Invalid or already-acknowledged capabilities reveal no job information.
  return c.body(null, 204);
});

app.get("/delivery", async (c) => {
  if (
    !c.env.ADMIN_TOKEN ||
    c.req.header("Authorization") !== `Bearer ${c.env.ADMIN_TOKEN}`
  )
    return c.json({ error: "Admin authentication required" }, 401);
  const rows = (
    await c.env.DB.prepare(
      `
    SELECT substr(o.subscription_id,1,12) AS device,
      CASE WHEN json_extract(s.subscription,'$.endpoint') LIKE 'https://web.push.apple.com/%' THEN 'Apple'
           WHEN json_extract(s.subscription,'$.endpoint') LIKE 'https://updates.push.services.mozilla.com/%' THEN 'Mozilla'
           WHEN json_extract(s.subscription,'$.endpoint') LIKE 'https://fcm.googleapis.com/%' THEN 'Google'
           ELSE 'Other' END AS provider,
      json_extract(o.payload,'$.tag') AS report,
      r.first_seen AS report_received_at,
      o.status,o.attempts,o.queued_at,o.first_attempt_at,o.last_attempt_at,o.accepted_at,
      o.receipt_at,o.device_received_at,o.device_shown_at,o.device_kind
    FROM push_outbox o JOIN push_subscriptions s ON s.id=o.subscription_id
    LEFT JOIN reports r ON r.id=json_extract(o.payload,'$.tag')
    WHERE o.queued_at>=? ORDER BY o.queued_at DESC,o.id LIMIT 200
  `,
    )
      .bind(Date.now() - 86400000)
      .all()
  ).results;
  return c.json({ generatedAt: Date.now(), rows });
});
export default app;
