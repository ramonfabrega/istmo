import { expect, it } from "vitest";
import receipts from "../worker/push-receipts";
import { database } from "./database";

it("accepts only the job capability, preserves the first receipt, and protects diagnostics", async () => {
  const { sqlite, env } = database();
  env.ADMIN_TOKEN = "admin-test";
  const token = "r".repeat(72);
  sqlite
    .prepare(
      "INSERT INTO push_subscriptions(id,subscription,token_hash,source,min_magnitude,created_at) VALUES('device',?,'private','up',0,?)",
    )
    .run(
      JSON.stringify({
        endpoint: "https://web.push.apple.com/secret-endpoint",
        keys: { auth: "private" },
      }),
      Date.now(),
    );
  sqlite
    .prepare(
      "INSERT INTO push_outbox(id,subscription_id,payload,next_attempt,expires_at,queued_at,receipt_token) VALUES('job','device','{}',?,?,?,?)",
    )
    .run(Date.now(), Date.now() + 60000, Date.now(), token);
  const receivedAt = Date.now();
  const post = (overrides = {}) =>
    receipts.request(
      "/receipt",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "job",
          token,
          receivedAt,
          shownAt: receivedAt + 10,
          deviceKind: "ios",
          ...overrides,
        }),
      },
      env,
    );
  try {
    expect((await post({ token: "wrong".padEnd(72, "x") })).status).toBe(204);
    expect(
      sqlite.prepare("SELECT receipt_at FROM push_outbox").get()?.receipt_at,
    ).toBeNull();
    expect((await post({ shownAt: receivedAt - 1 })).status).toBe(400);
    expect((await post({ deviceKind: "arbitrary user agent" })).status).toBe(
      400,
    );
    expect((await post()).status).toBe(204);
    const recorded = sqlite
      .prepare(
        "SELECT receipt_at,device_received_at,device_shown_at,device_kind FROM push_outbox",
      )
      .get();
    expect(recorded).toMatchObject({
      device_received_at: receivedAt,
      device_shown_at: receivedAt + 10,
      device_kind: "ios",
    });
    expect(recorded?.receipt_at).toEqual(expect.any(Number));
    await post({ receivedAt: receivedAt + 500, shownAt: receivedAt + 600 });
    expect(
      sqlite
        .prepare(
          "SELECT receipt_at,device_received_at,device_shown_at,device_kind FROM push_outbox",
        )
        .get(),
    ).toEqual(recorded);
    expect((await receipts.request("/delivery", {}, env)).status).toBe(401);
    const response = await receipts.request(
      "/delivery",
      { headers: { Authorization: "Bearer admin-test" } },
      env,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"provider":"Apple"');
    for (const secret of [token, "secret-endpoint", "private"])
      expect(text).not.toContain(secret);
  } finally {
    sqlite.close();
  }
});
