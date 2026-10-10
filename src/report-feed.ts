import type { Report, Source } from "../shared/types";
import { api } from "./api";
import { recordTiming } from "./performance";
import { PollingFeed } from "../shared/polling-feed";
export type ReportQuery = { hours: number; magnitude: number; scope: string };
export type ReportSnapshot = {
  reports: Report[];
  sources: Source[];
  generatedAt: number;
};
export const DEFAULT_REPORT_QUERY: ReportQuery = {
  hours: 24,
  magnitude: 0,
  scope: "panama",
};
type Feed = {
  current: PollingFeed<ReportSnapshot>;
  fresh: (after?: number) => Promise<ReportSnapshot>;
  dispose: () => void;
};
const feeds = new Map<string, Feed>();
function feed(query: ReportQuery) {
  const key = new URLSearchParams({
    hours: String(query.hours),
    magnitude: String(query.magnitude),
    scope: query.scope,
  }).toString();
  const existing = feeds.get(key);
  if (existing) return existing;
  let after = 0;
  let forceFresh = false;
  let generation = 0;
  const current = new PollingFeed(
    async () => {
      const epoch = generation;
      const params = new URLSearchParams(key);
      if (forceFresh) params.set("fresh", "1");
      else if (after) params.set("after", String(after));
      const requestedFresh = forceFresh || !!after;
      const started = performance.now();
      const result = await api<ReportSnapshot>(`/api/reports?${params}`, {
        signal: AbortSignal.timeout(10000),
      });
      recordTiming("reports.fetch", started, {
        fresh: requestedFresh,
        count: result.reports.length,
      });
      // Don't clear a newer push's freshness hint when an older request finishes.
      if (epoch === generation) {
        after = 0;
        forceFresh = false;
      }
      return result;
    },
    () => !document.hidden,
  );
  const fresh = (minimum = 0) => {
    if (Number.isFinite(minimum) && minimum > 0)
      after = Math.max(after, minimum);
    else forceFresh = true;
    generation++;
    return current.refresh(true);
  };
  const resume = () => {
    if (!document.hidden) void fresh().catch(() => {});
  };
  const pushed = (event: MessageEvent) => {
    if (event.data?.type === "istmo:report")
      void fresh(event.data.after).catch(() => {});
  };
  const restored = (event: PageTransitionEvent) => {
    if (event.persisted) resume();
  };
  navigator.serviceWorker?.addEventListener("message", pushed);
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  window.addEventListener("pageshow", restored);
  const entry: Feed = {
    current,
    fresh,
    dispose: () => {
      if (current.size || feeds.get(key) !== entry) return;
      navigator.serviceWorker?.removeEventListener("message", pushed);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", restored);
      feeds.delete(key);
    },
  };
  feeds.set(key, entry);
  return entry;
}
export function subscribeReports(
  query: ReportQuery,
  data: (snapshot: ReportSnapshot) => void,
  error: (error: unknown) => void,
  background = false,
) {
  const entry = feed(query);
  const unsubscribe = entry.current.subscribe(data, error, background);
  return () => {
    unsubscribe();
    entry.dispose();
  };
}
export function refreshReports(query: ReportQuery) {
  const entry = feed(query);
  return entry.fresh().finally(entry.dispose);
}
