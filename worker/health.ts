import type { Env } from "./env";
export async function health(env: Env, now = Date.now()) {
  const sources = (
    await env.DB.prepare("SELECT id,last_success,error FROM sources").all<{
      id: string;
      last_success: number | null;
      error: string | null;
    }>()
  ).results.map((source) => ({
    id: source.id,
    lastSuccess: source.last_success,
    state: source.error
      ? "error"
      : !source.last_success || now - source.last_success > 180000
        ? "stale"
        : "ok",
  }));
  const push = await env.DB.prepare(
    "SELECT COUNT(CASE WHEN status='pending' THEN 1 END) AS pending, COUNT(CASE WHEN status='pending' AND (last_error IS NOT NULL OR next_attempt<?) THEN 1 END) AS stalled, COUNT(CASE WHEN status='expired' AND attempts>0 THEN 1 END) AS failed, COUNT(CASE WHEN status='accepted' THEN 1 END) AS accepted FROM push_outbox WHERE expires_at>?",
  )
    .bind(now - 120000, now - 86400000)
    .first<{
      pending: number;
      stalled: number;
      failed: number;
      accepted: number;
    }>();
  const heartbeat = await env.DB.prepare(
    "SELECT checked_at FROM runtime_health WHERE id='cron'",
  ).first<{ checked_at: number }>();
  const cron = {
    lastRun: heartbeat?.checked_at ?? null,
    state: !heartbeat || now - heartbeat.checked_at > 180000 ? "stale" : "ok",
  };
  const configured = Boolean(
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT,
  );
  const ok =
    sources.length === 2 &&
    sources.every((source) => source.state === "ok") &&
    cron.state === "ok" &&
    configured &&
    !push?.stalled;
  return {
    ok,
    environment: env.APP_ENV,
    time: now,
    sources,
    cron,
    push: { ...push!, configured },
  };
}
export async function maintain(env: Env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE push_outbox SET status='expired',claim_token=NULL,claim_until=NULL WHERE status='pending' AND expires_at<?",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM push_outbox WHERE status IN ('accepted','expired') AND expires_at<?",
    ).bind(now - 7 * 86400000),
    env.DB.prepare(
      "INSERT INTO runtime_health(id,checked_at,state) VALUES('cron',?,'ok') ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at",
    ).bind(now),
  ]);
  const current = await health(env, now);
  // State changes only; never log payloads, device IDs, endpoints or credentials.
  const state = JSON.stringify({
    sources: current.sources.map(({ id, state }) => ({ id, state })),
    push: !current.push.configured
      ? "unconfigured"
      : current.push.stalled
        ? "stalled"
        : "ok",
  });
  const previous = await env.DB.prepare(
    "SELECT state FROM runtime_health WHERE id='monitor'",
  ).first<{ state: string }>();
  if (previous?.state !== state) {
    console.info(
      JSON.stringify({ event: "health_transition", ...JSON.parse(state) }),
    );
    await env.DB.prepare(
      "INSERT INTO runtime_health(id,checked_at,state) VALUES('monitor',?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,state=excluded.state",
    )
      .bind(now, state)
      .run();
  }
  return current;
}
