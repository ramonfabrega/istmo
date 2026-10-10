import {
  buildPushPayload,
  type PushSubscription,
} from "@block65/webcrypto-web-push";
import type { Env } from "./env";

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

interface PushJob {
  id: string;
  subscription_id: string;
  subscription: string;
  payload: string;
  attempts: number;
  expires_at: number;
  queued_at: number | null;
}

async function deliver(env: Env, job: PushJob) {
  const claim = crypto.randomUUID();
  const now = Date.now();
  const acquired = await env.DB.prepare(
    "UPDATE push_outbox SET claim_token=?,claim_until=?,receipt_token=COALESCE(receipt_token,?),first_attempt_at=COALESCE(first_attempt_at,?),last_attempt_at=? WHERE id=? AND status='pending' AND expires_at>? AND next_attempt<=? AND (claim_until IS NULL OR claim_until<?) RETURNING receipt_token",
  )
    .bind(
      claim,
      now + 60000,
      crypto.randomUUID() + crypto.randomUUID(),
      now,
      now,
      job.id,
      now,
      now,
      now,
    )
    .first<{ receipt_token: string }>();
  if (!acquired) return;
  try {
    const subscription = JSON.parse(job.subscription) as PushSubscription;
    if (!validSubscription(subscription))
      throw new Error("Invalid subscription endpoint");
    const ttl = Math.min(300, Math.floor((job.expires_at - Date.now()) / 1000));
    if (ttl <= 0) {
      await env.DB.prepare(
        "UPDATE push_outbox SET status='expired',claim_token=NULL,claim_until=NULL WHERE id=? AND claim_token=?",
      )
        .bind(job.id, claim)
        .run();
      return;
    }
    const payload = await buildPushPayload(
      {
        data: JSON.stringify({
          ...JSON.parse(job.payload),
          delivery: {
            id: job.id,
            token: acquired.receipt_token,
            catalogAfter: now,
          },
        }),
        options: { ttl, urgency: "high" },
      },
      subscription,
      {
        subject: env.VAPID_SUBJECT!,
        publicKey: env.VAPID_PUBLIC_KEY!,
        privateKey: env.VAPID_PRIVATE_KEY!,
      },
    );
    const res = await fetch(subscription.endpoint, {
      ...payload,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404 || res.status === 410) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM push_outbox WHERE subscription_id=?").bind(
          job.subscription_id,
        ),
        env.DB.prepare("DELETE FROM push_subscriptions WHERE id=?").bind(
          job.subscription_id,
        ),
      ]);
      return;
    }
    if (!res.ok) throw new Error(`Push service ${res.status}`);
    await env.DB.prepare(
      "UPDATE push_outbox SET status='accepted',accepted_at=?,attempts=attempts+1,last_error=NULL,claim_token=NULL,claim_until=NULL WHERE id=? AND claim_token=?",
    )
      .bind(Date.now(), job.id, claim)
      .run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE push_outbox SET attempts=attempts+1,next_attempt=?,last_error=?,claim_token=NULL,claim_until=NULL WHERE id=? AND claim_token=?",
    )
      .bind(
        Date.now() + Math.min(300000, 30000 * 2 ** job.attempts),
        error instanceof Error ? error.message : "Push delivery failed",
        job.id,
        claim,
      )
      .run();
  }
}

/** Eight in-flight sends per drain, multiple pages, and a bounded runtime.
 * Concurrent drains are safe through per-job leases; overdue work stays durable
 * for the next cron. A slow device doesn't hold up the other seven lanes. */
export async function drainPush(env: Env, onlyJob?: string) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT)
    return;
  await env.DB.prepare(
    "UPDATE push_outbox SET status='expired' WHERE status='pending' AND expires_at<?",
  )
    .bind(Date.now())
    .run();
  const deadline = Date.now() + 20000;
  for (let page = 0; page < 5 && Date.now() < deadline; page++) {
    const now = Date.now();
    const jobs = (
      await env.DB.prepare(
        "SELECT o.*,s.subscription FROM push_outbox o JOIN push_subscriptions s ON o.subscription_id=s.id WHERE o.status='pending' AND o.next_attempt<=? AND o.expires_at>? AND (o.claim_until IS NULL OR o.claim_until<?) AND (? IS NULL OR o.id=?) ORDER BY o.next_attempt,o.id LIMIT 100",
      )
        .bind(now, now, now, onlyJob ?? null, onlyJob ?? null)
        .all<PushJob>()
    ).results;
    if (!jobs.length) return;
    let cursor = 0;
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(8, jobs.length) }, async () => {
        while (cursor < jobs.length && Date.now() < deadline) {
          const job = jobs[cursor++];
          await deliver(env, job);
        }
      }),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error(
        "Push queue database operation failed; remaining jobs will retry.",
      );
    if (onlyJob) return;
  }
}
