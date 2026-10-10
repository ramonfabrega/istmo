import type { Report } from "../shared/types";
import type { ParsedReport } from "./parsers";
export type StoredReport = Report & { withdrawn_at: number | null };

// UP preliminary locations can move substantially during review. Identity still
// requires a unique disappearing/replacement pair, close time and magnitude.
export const UP_CORRECTION_TIME_MS = 10_000;

function nearby(a: ParsedReport, b: StoredReport) {
  const dy = (a.latitude - b.latitude) * 111.2;
  const dx =
    (a.longitude - b.longitude) *
    111.2 *
    Math.cos((a.latitude * Math.PI) / 180);
  return (
    Math.abs(a.occurred_at - b.occurred_at) <= UP_CORRECTION_TIME_MS &&
    Math.hypot(dx, dy) <= 100 &&
    Math.abs(a.magnitude - b.magnitude) <= 0.6
  );
}

/** Only infer a correction when one row disappears and exactly one nearby row
 * replaces it. Rows that coexist in the incoming snapshot always stay distinct.
 * Ambiguous disappearances remain archived, without claiming an identity match. */
export function reconcileUP(
  incoming: ParsedReport[],
  previous: StoredReport[],
) {
  const assigned = new Map<ParsedReport, StoredReport>();
  const used = new Set<string>();
  for (const r of incoming) {
    const exact = previous.filter((p) => p.occurred_at === r.occurred_at);
    const match = exact.find((p) => p.withdrawn_at === null) ?? exact[0];
    if (match) {
      assigned.set(r, match);
      used.add(match.id);
    }
  }
  const unmatched = incoming.filter((r) => !assigned.has(r));
  const missing = previous.filter(
    (p) => p.withdrawn_at === null && !used.has(p.id),
  );
  for (const r of unmatched) {
    const candidates = missing.filter((p) => nearby(r, p));
    if (candidates.length !== 1) continue;
    const p = candidates[0];
    if (unmatched.filter((other) => nearby(other, p)).length !== 1) continue;
    assigned.set(r, p);
    used.add(p.id);
  }
  const oldest = Math.min(...incoming.map((r) => r.occurred_at));
  const newest = Math.max(...incoming.map((r) => r.occurred_at));
  return {
    rows: incoming.map((report) => ({
      report,
      previous: assigned.get(report),
    })),
    // Don't interpret aging out of a rolling feed as a withdrawal. Include a
    // tiny upper margin because a correction can move the newest origin earlier.
    withdrawn: previous.filter(
      (p) =>
        p.withdrawn_at === null &&
        !used.has(p.id) &&
        p.occurred_at >= oldest &&
        p.occurred_at <= newest + UP_CORRECTION_TIME_MS,
    ),
  };
}

/** A first sync or a catch-up after an outage is a baseline, not a burst of alerts. */
export function newReportTime(
  report: ParsedReport,
  lastSuccess: number | null,
  now: number,
) {
  return lastSuccess !== null &&
    now - lastSuccess <= 5 * 60000 &&
    report.occurred_at >= now - 15 * 60000 &&
    report.occurred_at <= now + 60000
    ? now
    : null;
}
