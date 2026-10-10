import type { Report } from "../shared/types";

// Highlight newly received, recent reports; don't animate a historical import.
export function isFreshReport(
  report: Pick<Report, "new_report_at" | "occurred_at">,
  now: number,
) {
  return (
    report.new_report_at != null &&
    now >= report.new_report_at &&
    now - report.new_report_at < 180_000 &&
    now >= report.occurred_at &&
    now - report.occurred_at < 15 * 60_000
  );
}

export function pointCollection(
  items: Array<{
    id: string;
    longitude: number;
    latitude: number;
    magnitude?: number;
  }>,
) {
  return {
    type: "FeatureCollection" as const,
    features: items.map((r) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [r.longitude, r.latitude],
      },
      properties: {
        id: r.id,
        ...(r.magnitude === undefined ? {} : { magnitude: r.magnitude }),
      },
    })),
  };
}
