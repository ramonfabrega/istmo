import type { Report, Source } from "../shared/types";
import { api } from "./api";
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
const feeds = new Map<string, PollingFeed<ReportSnapshot>>();
function feed(query: ReportQuery) {
  const key = new URLSearchParams({
    hours: String(query.hours),
    magnitude: String(query.magnitude),
    scope: query.scope,
  }).toString();
  let existing = feeds.get(key);
  if (!existing) {
    existing = new PollingFeed(
      () =>
        api<ReportSnapshot>(`/api/reports?${key}`, {
          signal: AbortSignal.timeout(10000),
        }),
      () => !document.hidden,
    );
    feeds.set(key, existing);
  }
  return { key, current: existing };
}
export function subscribeReports(
  query: ReportQuery,
  data: (snapshot: ReportSnapshot) => void,
  error: (error: unknown) => void,
  background = false,
) {
  const { key, current } = feed(query);
  const unsubscribe = current.subscribe(data, error, background);
  const resume = () => {
    if (!document.hidden) void current.refresh().catch(() => {});
  };
  const pushed = (event: MessageEvent) => {
    if (event.data?.type === "istmo:report")
      void current.refresh().catch(() => {});
  };
  navigator.serviceWorker?.addEventListener("message", pushed);
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  return () => {
    unsubscribe();
    navigator.serviceWorker?.removeEventListener("message", pushed);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("online", resume);
    if (!current.size) feeds.delete(key);
  };
}
export function refreshReports(query: ReportQuery) {
  const { key, current } = feed(query);
  return current.refresh().finally(() => {
    if (!current.size) feeds.delete(key);
  });
}
