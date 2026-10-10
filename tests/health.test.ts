import { expect, it, vi } from "vitest";
import { database } from "./database";
import { health, maintain } from "../worker/health";
it("detects stale feeds, errors, scheduler absence and push configuration without returning secrets", async () => {
  const { sqlite, env } = database();
  try {
    expect((await health(env)).ok).toBe(false);
    const now = Date.now();
    sqlite.prepare("UPDATE sources SET last_success=?").run(now);
    Object.assign(env, {
      VAPID_PUBLIC_KEY: "public",
      VAPID_PRIVATE_KEY: "secret",
      VAPID_SUBJECT: "subject",
    });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect((await maintain(env, now)).ok).toBe(true);
      await maintain(env, now + 1000);
      expect(log).toHaveBeenCalledOnce();
      const stale = await health(env, now + 182000);
      expect(stale.ok).toBe(false);
      expect(stale.cron.state).toBe("stale");
      expect(stale.sources.every((s) => s.state === "stale")).toBe(true);
      sqlite.exec(
        "UPDATE sources SET error='Upstream unavailable' WHERE id='up'",
      );
      expect(
        (await health(env, now)).sources.find((s) => s.id === "up")?.state,
      ).toBe("error");
      expect(JSON.stringify(await health(env, now))).not.toContain("secret");
    } finally {
      log.mockRestore();
    }
  } finally {
    sqlite.close();
  }
});
it("expires unsent notifications and prunes only terminal outbox rows older than seven days", async () => {
  const { sqlite, env } = database();
  const now = Date.now();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    sqlite
      .prepare(
        "INSERT INTO push_subscriptions(id,subscription,token_hash,source,min_magnitude,created_at) VALUES('d','{}','hash','up',3,?)",
      )
      .run(now);
    const insert = sqlite.prepare(
      "INSERT INTO push_outbox(id,subscription_id,payload,next_attempt,expires_at,status,attempts,last_error) VALUES(?,'d','{}',?,?,?,1,'test error')",
    );
    insert.run("old", now, now - 8 * 86400000, "accepted");
    insert.run("recent", now, now - 1000, "accepted");
    insert.run("expired", now, now - 1000, "pending");
    insert.run("pending", now - 180000, now + 60000, "pending");
    const state = await maintain(env, now);
    expect(state.push.stalled).toBe(1);
    expect(state.push.failed).toBe(1);
    expect(
      sqlite.prepare("SELECT status FROM push_outbox WHERE id='expired'").get()
        ?.status,
    ).toBe("expired");
    expect(
      sqlite
        .prepare("SELECT id FROM push_outbox ORDER BY id")
        .all()
        .map((r) => r.id),
    ).toEqual(["expired", "pending", "recent"]);
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM push_subscriptions").get()?.n,
    ).toBe(1);
  } finally {
    log.mockRestore();
    sqlite.close();
  }
});
