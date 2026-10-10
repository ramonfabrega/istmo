import { afterEach, expect, it, vi } from "vitest";
import { storeReports } from "../worker/collect";
import { database } from "./database";

function html(times: number[]) {
  return `<table>${times
    .map((time) => {
      const local = new Date(time - 5 * 3600000);
      const h = local.getUTCHours();
      const stamp = `${h % 12 || 12}:${String(local.getUTCMinutes()).padStart(2, "0")}:${String(local.getUTCSeconds()).padStart(2, "0")}${h >= 12 ? "PM" : "AM"}`;
      return `<tr>${["PRELIMINAR", local.toISOString().slice(0, 10), stamp, "7.62", "-81.44", "10km", "4.7", "Test location", '<a href="ultimosismo.html">Ver</a>'].map((c) => `<td>${c}</td>`).join("")}</tr>`;
    })
    .join("")}</table>`;
}
afterEach(() => vi.useRealTimers());
it("persists bootstrap, corrections, incremental arrivals and withdrawals without duplicates", async () => {
  vi.useFakeTimers();
  const now = Date.parse("2026-10-10T05:00:00Z");
  const origin = now - 60000;
  const older = now - 600000;
  vi.setSystemTime(now);
  const { sqlite, env } = database();
  try {
    await storeReports(env, "up", html([origin, older]));
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM reports WHERE new_report_at IS NOT NULL",
        )
        .get()?.n,
    ).toBe(0);
    vi.setSystemTime(now + 60000);
    const newest = now + 30000;
    await storeReports(env, "up", html([newest, origin + 1000, older]));
    const corrected = sqlite
      .prepare(
        "SELECT id,occurred_at,revision,new_report_at FROM reports WHERE id=?",
      )
      .get(`up:${origin}`);
    expect(corrected).toMatchObject({
      occurred_at: origin + 1000,
      revision: 2,
      new_report_at: null,
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM reports").get()?.n).toBe(
      3,
    );
    expect(
      sqlite
        .prepare("SELECT new_report_at FROM reports WHERE id=?")
        .get(`up:${newest}`)?.new_report_at,
    ).toBe(now + 60000);
    vi.setSystemTime(now + 120000);
    await storeReports(env, "up", html([newest, older]));
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM reports WHERE withdrawn_at IS NULL")
        .get()?.n,
    ).toBe(2);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM report_revisions WHERE report_id=?")
        .get(`up:${origin}`)?.n,
    ).toBe(2);
    // Parse failure must leave the last valid snapshot untouched.
    await expect(
      storeReports(env, "up", "<html>Unavailable</html>"),
    ).rejects.toThrow();
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM reports WHERE withdrawn_at IS NULL")
        .get()?.n,
    ).toBe(2);
  } finally {
    sqlite.close();
  }
});

it.each([
  {
    name: "tonosi",
    first: 1791615082073,
    correction: 1791615502090,
    original: 1791614870000,
    corrected: 1791614869000,
  },
  {
    name: "las-tablas",
    first: 1791613769177,
    correction: 1791613829393,
    original: 1791613634000,
    corrected: 1791613631000,
  },
  {
    name: "offshore",
    first: 1791614482077,
    correction: 1791614542278,
    original: 1791613792000,
    corrected: 1791613801000,
  },
])(
  "keeps the archived $name relocation as a revision without another notification",
  async ({ name, first, correction, original, corrected }) => {
    const { readFileSync } = await import("node:fs");
    const before = readFileSync(
      `tests/fixtures/up-corrections/${name}-before.html`,
      "utf8",
    );
    const after = readFileSync(
      `tests/fixtures/up-corrections/${name}-after.html`,
      "utf8",
    );
    vi.useFakeTimers();
    const { sqlite, env } = database();
    try {
      sqlite
        .prepare("UPDATE sources SET last_success=? WHERE id='up'")
        .run(first - 60000);
      sqlite
        .prepare(
          "INSERT INTO push_subscriptions(id,token_hash,subscription,source,min_magnitude,created_at) VALUES('test','test','{}','up',0,?)",
        )
        .run(first);
      vi.setSystemTime(first);
      await storeReports(env, "up", before);
      const notifications = sqlite
        .prepare("SELECT count(*) AS n FROM push_outbox")
        .get()?.n;
      // The real collector kept polling unchanged snapshots between revisions.
      vi.setSystemTime(correction - 60000);
      await storeReports(env, "up", before);
      vi.setSystemTime(correction);
      await storeReports(env, "up", after);
      const records = sqlite
        .prepare("SELECT * FROM reports WHERE occurred_at BETWEEN ? AND ?")
        .all(Math.min(original, corrected), Math.max(original, corrected));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        id: `up:${original}`,
        occurred_at: corrected,
        revision: 2,
        first_seen: first,
        new_report_at: first,
        withdrawn_at: null,
      });
      expect(
        sqlite
          .prepare(
            "SELECT count(*) AS n FROM report_revisions WHERE report_id=?",
          )
          .get(`up:${original}`)?.n,
      ).toBe(2);
      expect(
        sqlite.prepare("SELECT count(*) AS n FROM push_outbox").get()?.n,
      ).toBe(notifications);
    } finally {
      sqlite.close();
    }
  },
);

it("loads a correction candidate nine seconds before the oldest incoming row", async () => {
  vi.useFakeTimers();
  const first = Date.parse("2026-10-10T05:00:00Z");
  const origin = first - 60000;
  const { sqlite, env } = database();
  try {
    vi.setSystemTime(first);
    await storeReports(env, "up", html([origin]));
    vi.setSystemTime(first + 60000);
    await storeReports(env, "up", html([origin + 9000]));
    expect(sqlite.prepare("SELECT id,revision FROM reports").all()).toEqual([
      { id: `up:${origin}`, revision: 2 },
    ]);
  } finally {
    sqlite.close();
  }
});

it("does not infer identity for the much larger archived David/Tonosí change", async () => {
  const { readFileSync } = await import("node:fs");
  vi.useFakeTimers();
  const { sqlite, env } = database();
  try {
    vi.setSystemTime(1791611909396);
    await storeReports(
      env,
      "up",
      readFileSync(
        "tests/fixtures/up-corrections/uncertain-before.html",
        "utf8",
      ),
    );
    vi.setSystemTime(1791611969631);
    await storeReports(
      env,
      "up",
      readFileSync(
        "tests/fixtures/up-corrections/uncertain-after.html",
        "utf8",
      ),
    );
    expect(
      sqlite
        .prepare(
          "SELECT id,revision,withdrawn_at FROM reports WHERE occurred_at BETWEEN 1791611787000 AND 1791611804000 ORDER BY occurred_at",
        )
        .all(),
    ).toEqual([
      { id: "up:1791611787000", revision: 1, withdrawn_at: 1791611969631 },
      { id: "up:1791611804000", revision: 1, withdrawn_at: null },
    ]);
  } finally {
    sqlite.close();
  }
});
