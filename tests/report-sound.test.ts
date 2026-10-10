import { describe, expect, it } from "vitest";
import { newAudibleReports, magnitudeBand } from "../src/report-sound";
import type { Report } from "../shared/types";
const now = 1_800_000_000_000;
const report = (patch: Partial<Report> = {}) =>
  ({
    id: "up:new",
    source: "up",
    magnitude: 4,
    first_seen: now - 1000,
    new_report_at: now - 1000,
    occurred_at: now - 60000,
    ...patch,
  }) as Report;
describe("audible reports", () => {
  it("accepts newly received, recent reports matching the chosen agency and magnitude", () => {
    const fresh = report();
    expect(
      newAudibleReports(
        [
          fresh,
          report({ id: "low", magnitude: 2 }),
          report({ id: "usgs", source: "usgs" }),
        ],
        new Set(),
        now - 30000,
        now,
        "up",
        3,
      ),
    ).toEqual([fresh]);
  });
  it("rejects known revisions, older imports, reports outside the receipt window, and future events", () => {
    const inputs = [
      report({ id: "known", revision: 4 }),
      report({ id: "historical", occurred_at: now - 3600000 }),
      report({ id: "oldreceipt", new_report_at: now - 60000 }),
      report({ id: "baseline", new_report_at: null }),
      report({ id: "future", occurred_at: now + 3600000 }),
    ];
    expect(
      newAudibleReports(inputs, new Set(["known"]), now - 30000, now, "up", 3),
    ).toEqual([]);
  });
});

describe("magnitude chime bands", () => {
  it("moves up at half-magnitude boundaries without rounding a report upward", () => {
    expect(magnitudeBand(3.49).note).toBe("C4");
    expect(magnitudeBand(3.5).note).toBe("D4");
    expect(magnitudeBand(4.49).note).toBe("E4");
    expect(magnitudeBand(4.5).note).toBe("F4");
    expect(magnitudeBand(6.49).note).toBe("B4");
    expect(magnitudeBand(6.5).note).toBe("C5");
  });
  it("caps the scale for small and large events", () => {
    expect(magnitudeBand(-1).frequency).toBe(magnitudeBand(3).frequency);
    expect(magnitudeBand(9.5).frequency).toBe(magnitudeBand(6.5).frequency);
  });
});

it("does not lose a report collected between snapshot generation and receipt", () => {
  const generatedAt = now - 5000;
  const receivedAt = now;
  const collected = report({ new_report_at: generatedAt + 1000 });
  expect(
    newAudibleReports(
      [collected],
      new Set(),
      generatedAt,
      receivedAt + 15000,
      "up",
      3,
    ),
  ).toEqual([collected]);
  expect(
    newAudibleReports(
      [collected],
      new Set([collected.id]),
      generatedAt,
      receivedAt + 15000,
      "up",
      3,
    ),
  ).toEqual([]);
});
