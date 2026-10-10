import { afterEach, expect, it, vi } from "vitest";
import { database } from "./database";
import { drainPush } from "../worker/push";
import push from "../worker/push";
import { digest } from "../worker/crypto";

async function setup() {
  const state = database();
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicKey = Buffer.from(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  ).toString("base64url");
  const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!;
  Object.assign(state.env, {
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: "https://example.com",
  });
  const subscription = {
    endpoint: "https://web.push.apple.com/test-only",
    keys: {
      p256dh: publicKey,
      auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
        "base64url",
      ),
    },
  };
  state.sqlite
    .prepare(
      "INSERT INTO push_subscriptions(id,subscription,token_hash,source,min_magnitude,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      "device",
      JSON.stringify(subscription),
      await digest("test-token"),
      "up",
      3,
      Date.now(),
    );
  return state;
}
afterEach(() => vi.unstubAllGlobals());
it("sends encrypted payloads using Workers-compatible redirect handling and reports acceptance", async () => {
  const { sqlite, env } = await setup();
  const send = vi.fn(async (_url, request) => {
    expect(request.redirect).toBe("manual");
    expect(request.method).toBe("post");
    expect(request.body.byteLength).toBeGreaterThan(80);
    return new Response(null, { status: 201 });
  });
  vi.stubGlobal("fetch", send);
  try {
    const response = await push.request(
      "/test",
      {
        method: "POST",
        body: JSON.stringify({ id: "device", token: "test-token" }),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(send).toHaveBeenCalledOnce();
    expect(sqlite.prepare("SELECT status FROM push_outbox").get()?.status).toBe(
      "accepted",
    );
  } finally {
    sqlite.close();
  }
});
it.each([302, 403, 500])(
  "reports push-service %s errors instead of claiming the test worked",
  async (status) => {
    const { sqlite, env } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    try {
      const response = await push.request(
        "/test",
        {
          method: "POST",
          body: JSON.stringify({ id: "device", token: "test-token" }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );
      expect(response.status).toBe(502);
      expect(((await response.json()) as { error: string }).error).toContain(
        String(status),
      );
      expect(
        sqlite.prepare("SELECT attempts FROM push_outbox").get()?.attempts,
      ).toBe(1);
      await drainPush(env);
      expect(fetch).toHaveBeenCalledOnce(); // respects retry backoff
    } finally {
      sqlite.close();
    }
  },
);
it("removes expired subscriptions and tells the test caller to reconnect", async () => {
  const { sqlite, env } = await setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 410 })),
  );
  try {
    const response = await push.request(
      "/test",
      {
        method: "POST",
        body: JSON.stringify({ id: "device", token: "test-token" }),
        headers: { "Content-Type": "application/json" },
      },
      env,
    );
    expect(response.status).toBe(410);
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM push_subscriptions").get()?.n,
    ).toBe(0);
  } finally {
    sqlite.close();
  }
});
