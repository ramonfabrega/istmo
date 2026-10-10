import { describe, expect, it } from "vitest";
import { isFreshReport, pointCollection } from "../src/map-data";

describe("new report visibility", () => {
  const now = Date.parse("2026-10-10T05:00:00Z");
  it("keeps newly received recent reports outside clusters for three minutes", () => {
    const report = { new_report_at: now, occurred_at: now - 600_000 };
    expect(isFreshReport(report, now)).toBe(true);
    expect(isFreshReport(report, now + 179_999)).toBe(true);
    expect(isFreshReport(report, now + 180_000)).toBe(false);
  });
  it("does not highlight initial imports even when the earthquake was recent", () => {
    expect(
      isFreshReport({ new_report_at: null, occurred_at: now - 60000 }, now),
    ).toBe(false);
  });
  it("does not highlight historical imports or future timestamps", () => {
    expect(
      isFreshReport({ new_report_at: now, occurred_at: now - 3_600_000 }, now),
    ).toBe(false);
    expect(
      isFreshReport({ new_report_at: now + 1, occurred_at: now }, now),
    ).toBe(false);
    expect(
      isFreshReport({ new_report_at: now, occurred_at: now + 1 }, now),
    ).toBe(false);
  });
  it("ignores metadata-only revisions when building the cluster index", () => {
    const report = {
      id: "up:1",
      longitude: -80,
      latitude: 8,
      magnitude: 4.2,
      revision: 1,
    };
    expect(pointCollection([report])).toEqual(
      pointCollection([{ ...report, revision: 2 } as typeof report]),
    );
    expect(pointCollection([report])).not.toEqual(
      pointCollection([{ ...report, magnitude: 4.5 }]),
    );
  });
});
