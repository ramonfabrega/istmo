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
