import { load } from "cheerio";
import type { Report } from "../shared/types";
export type ParsedReport = Omit<
  Report,
  | "id"
  | "first_seen"
  | "new_report_at"
  | "updated_at"
  | "revision"
  | "fingerprint"
>;
export function panamaTime(date: string, time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !m)
    throw new Error("Unrecognized UP local time");
  const hour = Number(m[1]);
  if (hour < 1 || hour > 12 || Number(m[2]) > 59 || Number(m[3]) > 59)
    throw new Error("Invalid UP time");
  const h = (hour % 12) + (m[4].toUpperCase() === "PM" ? 12 : 0);
  const value = Date.parse(
    `${date}T${String(h).padStart(2, "0")}:${m[2]}:${m[3]}-05:00`,
  );
  if (!Number.isFinite(value)) throw new Error("Invalid UP date");
  return value;
}
function valid(r: ParsedReport) {
  return (
    Number.isFinite(r.occurred_at) &&
    Number.isFinite(r.magnitude) &&
    r.magnitude >= -2 &&
    r.magnitude <= 10 &&
    Number.isFinite(r.latitude) &&
    Math.abs(r.latitude) <= 90 &&
    Number.isFinite(r.longitude) &&
    Math.abs(r.longitude) <= 180 &&
    Number.isFinite(r.depth) &&
    r.depth >= -10 &&
    r.depth <= 1000
  );
}
export function parseUP(html: string): ParsedReport[] {
  const $ = load(html),
    out = new Map<string, ParsedReport>();
  let invalid = 0;
  $("tr").each((_, tr) => {
    const cells = $(tr).children("td");
    if (cells.length !== 9) return;
    const c = cells.toArray().map((x) => $(x).text().trim());
    if (!/PRELIMINAR|REVISADO/.test(c[0])) return;
    try {
      const occurred_at = panamaTime(c[1], c[2]);
      const link = $(cells[8]).find("a").attr("href");
      const url = new URL(link || "", "https://sismosgeociencias.up.ac.pa/");
      // This is a snapshot key, not an immutable event ID. The collector reconciles
      // unambiguous replacements when UP corrects the origin time.
      const r: ParsedReport = {
        source: "up",
        source_id: String(occurred_at),
        occurred_at,
        latitude: Number(c[3]),
        longitude: Number(c[4]),
        depth: parseFloat(c[5]),
        magnitude: Number(c[6]),
        magnitude_type: null,
        place: c[7],
        status: c[0] === "REVISADO" ? "reviewed" : "preliminary",
        url:
          url.origin === "https://sismosgeociencias.up.ac.pa"
            ? url.href
            : "https://sismosgeociencias.up.ac.pa/",
      };
      if (!valid(r)) throw new Error("Invalid values");
      out.set(r.source_id, r);
    } catch {
      invalid++;
    }
  });
  if (!out.size || invalid)
    throw new Error(
      `UP table invalid: ${out.size} parsed, ${invalid} invalid rows`,
    );
  return [...out.values()];
}
export function parseUSGS(data: unknown): ParsedReport[] {
  const feed = data as {
    type?: string;
    features?: Array<{
      id: string;
      properties: Record<string, unknown>;
      geometry: { coordinates: number[] };
    }>;
  };
  if (feed.type !== "FeatureCollection" || !Array.isArray(feed.features))
    throw new Error("Invalid USGS GeoJSON");
  return feed.features.flatMap((f) => {
    const p = f.properties,
      c = f.geometry?.coordinates;
    if (!c || p.mag == null) return [];
    const url = String(p.url || "");
    const r: ParsedReport = {
      source: "usgs",
      source_id: f.id,
      occurred_at: Number(p.time),
      latitude: c[1],
      longitude: c[0],
      depth: c[2],
      magnitude: Number(p.mag),
      magnitude_type: p.magType ? String(p.magType) : null,
      place: String(p.place || "Location pending"),
      status: p.status === "reviewed" ? "reviewed" : "preliminary",
      url: url.startsWith("https://earthquake.usgs.gov/")
        ? url
        : "https://earthquake.usgs.gov/",
    };
    return valid(r) ? [r] : [];
  });
}
