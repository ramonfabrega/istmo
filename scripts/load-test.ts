import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config";
const cfg = config();
const base = new URL(cfg.url);
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
  "Load tests only allow loopback hosts",
);
const health = (await (await fetch(new URL("/api/health", base))).json()) as {
  environment: string;
};
assert.equal(health.environment, "local", "Never load-test production");
const headers = { Authorization: `Bearer ${cfg.ADMIN_TOKEN}` };
const call = (path: string, init?: RequestInit) =>
  fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(15000) });
assert.equal((await call("/api/admin/viewers")).status, 401);
assert.equal(
  (
    await call("/api/admin/viewers", {
      headers: { Authorization: "Bearer wrong" },
    })
  ).status,
  401,
);
assert.equal(
  (await call("/api/presence", { method: "POST", body: '{"id":"bad"}' }))
    .status,
  400,
);
assert.equal(
  (
    await call("/api/presence", {
      method: "POST",
      headers: { Origin: "https://foreign.invalid" },
      body: JSON.stringify({ id: crypto.randomUUID() }),
    })
  ).status,
  403,
);
const before = (await (
  await call("/api/admin/viewers", { headers })
).json()) as { active: number };
const ids = Array.from({ length: 100 }, () => crypto.randomUUID());
for (let repeat = 0; repeat < 2; repeat++) {
  const responses = await Promise.all(
    ids.map((id) =>
      call("/api/presence", { method: "POST", body: JSON.stringify({ id }) }),
    ),
  );
  assert.ok(responses.every((r) => r.status === 204));
}
const after = (await (
  await call("/api/admin/viewers", { headers })
).json()) as { active: number };
assert.ok(
  after.active >= before.active + 100 && after.active <= before.active + 105,
  "Duplicate heartbeats must not double count (allow a few live dev tabs)",
);
console.log(
  "Presence: private, validated, origin-checked, 100 sessions deduplicated.",
);

const routes = [
  "/api/reports?hours=24&magnitude=0&scope=panama",
  "/api/stations",
  "/api/reports?scope=world&hours=24",
  "/api/reports?hours=6&magnitude=3&scope=panama",
];
const results: unknown[] = [];
for (const concurrency of [25, 100, 250]) {
  const started = performance.now();
  const samples: number[] = [];
  const cache: Record<string, number> = {};
  const statuses: Record<string, number> = {};
  let bytes = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async (_, client) => {
      while (performance.now() - started < 8000) {
        const begin = performance.now();
        try {
          const response = await call(routes[client % routes.length]);
          const body = await response.text();
          bytes += body.length;
          statuses[response.status] = (statuses[response.status] ?? 0) + 1;
          const state = response.headers.get("X-Istmo-Cache") ?? "none";
          cache[state] = (cache[state] ?? 0) + 1;
          assert.equal(response.headers.get("Cache-Control"), "no-store");
          JSON.parse(body);
        } catch {
          statuses.networkOrValidationError =
            (statuses.networkOrValidationError ?? 0) + 1;
        }
        samples.push(performance.now() - begin);
      }
    }),
  );
  const elapsed = performance.now() - started;
  samples.sort((a, b) => a - b);
  const percentile = (p: number) =>
    Math.round(
      samples[Math.min(samples.length - 1, Math.floor(samples.length * p))],
    );
  const row = {
    concurrency,
    requests: samples.length,
    requestsPerSecond: Math.round((samples.length / elapsed) * 1000),
    p50ms: percentile(0.5),
    p95ms: percentile(0.95),
    p99ms: percentile(0.99),
    megabytes: Math.round(bytes / 1e6),
    statuses,
    cache,
  };
  results.push(row);
  console.log(JSON.stringify(row));
}
// Exercise the real local D1 -> Worker -> edge cache path. No synthetic push is queued.
const run = promisify(execFile);
const sql = (command: string) =>
  run(process.execPath, [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "istmo-local",
    "--local",
    "--command",
    command,
  ]);
const id = `local-load-${crypto.randomUUID()}`;
const path = "/api/reports?hours=1&magnitude=0&scope=world";
const snapshot = async () => {
  const response = await call(path);
  assert.equal(response.status, 200);
  return (await response.json()) as {
    reports: Array<{ id: string; magnitude: number }>;
  };
};
async function observe(
  label: string,
  matches: (rows: Awaited<ReturnType<typeof snapshot>>["reports"]) => boolean,
) {
  const started = performance.now();
  while (performance.now() - started < 7500) {
    if (matches((await snapshot()).reports)) {
      const ms = Math.round(performance.now() - started);
      console.log(`${label} visible after local write completed: ${ms} ms`);
      return ms;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} remained stale beyond the cache budget`);
}
try {
  await snapshot();
  const now = Date.now();
  await sql(
    `INSERT INTO reports(id,source,source_id,occurred_at,latitude,longitude,depth,magnitude,place,status,url,first_seen,updated_at,fingerprint) VALUES('${id}','usgs','${id}',${now},8,-80,10,0,'LOCAL LOAD TEST','preliminary','https://example.invalid',${now},${now},'load-test')`,
  );
  await observe("New report", (rows) => rows.some((r) => r.id === id));
  await sql(`UPDATE reports SET magnitude=1.23 WHERE id='${id}'`);
  await observe("Revision", (rows) =>
    rows.some((r) => r.id === id && r.magnitude === 1.23),
  );
  await sql(`UPDATE reports SET withdrawn_at=${Date.now()} WHERE id='${id}'`);
  await observe("Withdrawal", (rows) => !rows.some((r) => r.id === id));
} finally {
  await sql(`DELETE FROM reports WHERE id='${id}'`);
}
assert.ok(
  results.every((row) =>
    Object.keys((row as { statuses: Record<string, number> }).statuses).every(
      (s) => s === "200",
    ),
  ),
  "Load test had failed requests",
);
