import { describe, it, expect } from "vitest";
import {
  reconcileUP,
  newReportTime,
  type StoredReport,
} from "../worker/catalog";
import type { ParsedReport } from "../worker/parsers";
const base: ParsedReport = {
  source: "up",
  source_id: "100000",
  occurred_at: 100000,
  latitude: 7.62,
  longitude: -81.44,
  depth: 10,
  magnitude: 4.7,
  magnitude_type: null,
  place: "Coiba",
  status: "preliminary",
  url: "https://sismosgeociencias.up.ac.pa/",
};
const row = (
  time: number,
  extra: Partial<ParsedReport> = {},
): ParsedReport => ({
  ...base,
  source_id: String(time),
  occurred_at: time,
  ...extra,
});
const saved = (
  time: number,
  extra: Partial<StoredReport> = {},
): StoredReport => ({
  ...row(time),
  id: `up:${time}`,
  first_seen: 1,
  new_report_at: null,
  updated_at: 1,
  revision: 1,
  fingerprint: "old",
  withdrawn_at: null,
  ...extra,
});
describe("UP snapshot reconciliation", () => {
  it("keeps a stable ID through origin-time/location/magnitude corrections", () => {
    const prior = saved(100000);
    const plan = reconcileUP(
      [row(101000, { latitude: 7.68, magnitude: 4.8 })],
      [prior],
    );
    expect(plan.rows[0].previous?.id).toBe(prior.id);
    expect(plan.withdrawn).toEqual([]);
    const next = reconcileUP(
      [row(102000)],
      [{ ...prior, occurred_at: 101000 }],
    );
    expect(next.rows[0].previous?.id).toBe(prior.id);
  });
  it("does not merge earthquakes that coexist, even a second apart", () => {
    const prior = saved(100000);
    const plan = reconcileUP([row(100000), row(101000)], [prior]);
    expect(plan.rows[0].previous?.id).toBe(prior.id);
    expect(plan.rows[1].previous).toBeUndefined();
  });
  it("withdraws old duplicate rows while retaining the current matching report", () => {
    const plan = reconcileUP(
      [row(102000), row(90000)],
      [saved(100000), saved(101000), saved(102000), saved(90000)],
    );
    expect(plan.rows[0].previous?.id).toBe("up:102000");
    expect(plan.withdrawn.map((r) => r.id)).toEqual(["up:100000", "up:101000"]);
  });
  it("does not guess when a replacement could be either of two reports", () => {
    const plan = reconcileUP(
      [row(102000), row(90000)],
      [saved(100000), saved(101000), saved(90000)],
    );
    expect(plan.rows[0].previous).toBeUndefined();
  });
  it("does not guess when two incoming reports could replace one", () => {
    const plan = reconcileUP([row(101000), row(102000)], [saved(100000)]);
    expect(plan.rows.every((r) => !r.previous)).toBe(true);
  });
  it("preserves events aging out of the rolling feed and distant events", () => {
    const prior = saved(100000);
    const plan = reconcileUP(
      [row(101000, { latitude: 9 })],
      [prior, saved(1000)],
    );
    expect(plan.rows[0].previous).toBeUndefined();
    expect(plan.withdrawn).toEqual([]);
  });
  it.each([{ occurred_at: 111000 }, { latitude: 8.6 }, { magnitude: 5.4 }])(
    "keeps replacements outside the correction bounds separate: %j",
    (extra) => {
      expect(
        reconcileUP([row(100000, extra)], [saved(99000)]).rows[0].previous,
      ).toBeUndefined();
    },
  );
  it("does not resolve ambiguity merely because one candidate is closer", () => {
    const plan = reconcileUP(
      [row(100000)],
      [saved(99000), saved(92000, { latitude: 8.3 })],
    );
    expect(plan.rows[0].previous).toBeUndefined();
  });
  it("matches a returning withdrawn row without making a new identity", () => {
    expect(
      reconcileUP([row(100000)], [saved(100000, { withdrawn_at: 2 })]).rows[0]
        .previous?.id,
    ).toBe("up:100000");
  });
});

it("only signals incremental recent reports, never bootstrap or outage catch-up", () => {
  const now = 10000000;
  const r = row(now - 60000);
  expect(newReportTime(r, null, now)).toBeNull();
  expect(newReportTime(r, now - 6 * 60000, now)).toBeNull();
  expect(newReportTime(row(now - 16 * 60000), now - 60000, now)).toBeNull();
  expect(newReportTime(r, now - 60000, now)).toBe(now);
});
