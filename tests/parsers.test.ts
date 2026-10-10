import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseUP, parseUSGS, panamaTime } from "../worker/parsers";
describe("UP public table", () => {
  it("parses the real table once despite responsive duplicates", () => {
    const rows = parseUP(fs.readFileSync("fixtures/up.html", "utf8"));
    expect(rows.length).toBeGreaterThan(70);
    expect(new Set(rows.map((x) => x.source_id)).size).toBe(rows.length);
    const main = rows.find(
      (x) => x.occurred_at === Date.parse("2026-10-09T17:56:05Z"),
    );
    expect(main).toMatchObject({
      magnitude: 7.2,
      status: "reviewed",
      latitude: 7.55936,
    });
  });
  it("handles noon, midnight, and UTC day boundaries in Panama", () => {
    expect(panamaTime("2026-10-09", "12:00:00AM")).toBe(
      Date.parse("2026-10-09T05:00:00Z"),
    );
    expect(panamaTime("2026-10-09", "12:00:00PM")).toBe(
      Date.parse("2026-10-09T17:00:00Z"),
    );
    expect(panamaTime("2026-10-09", "11:59:59PM")).toBe(
      Date.parse("2026-10-10T04:59:59Z"),
    );
  });
  it("fails closed on a changed or error page", () => {
    expect(() => parseUP("<html>Upstream unavailable</html>")).toThrow();
    expect(() => panamaTime("2026-10-09", "13:00:00PM")).toThrow();
  });
});
describe("USGS", () => {
  it("preserves agency magnitude type and rejects unknown magnitude", () => {
    const feature = {
      id: "test",
      properties: {
        time: 1000,
        mag: 4.2,
        magType: "mb",
        status: "reviewed",
        place: "Panama",
        url: "https://earthquake.usgs.gov/x",
      },
      geometry: { coordinates: [-80, 8, 10] },
    };
    expect(
      parseUSGS({ type: "FeatureCollection", features: [feature] }),
    ).toMatchObject([{ magnitude_type: "mb", latitude: 8, longitude: -80 }]);
    expect(
      parseUSGS({
        type: "FeatureCollection",
        features: [
          { ...feature, properties: { ...feature.properties, mag: null } },
        ],
      }),
    ).toEqual([]);
  });
});
