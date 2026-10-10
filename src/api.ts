import { t, getLocale } from "./i18n";
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, options);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      data.error?.startsWith("Delivery failed: ")
        ? t("Delivery failed: {reason}", { reason: data.error.slice(17) })
        : data.error
          ? t(data.error)
          : t("Request failed ({status})", { status: response.status }),
    );
  return data;
}
export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(kind: "minute" | "second" | "date") {
  const key = `${getLocale()}:${kind}`;
  if (!formatters.has(key))
    formatters.set(
      key,
      new Intl.DateTimeFormat(getLocale() === "es" ? "es-PA" : "en", {
        timeZone: "America/Panama",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        ...(kind === "second" ? { second: "2-digit" as const } : {}),
        ...(kind === "date"
          ? { month: "short" as const, day: "numeric" as const }
          : {}),
      }),
    );
  return formatters.get(key)!;
}
export const localTime = (time: number, seconds = false) =>
  formatter(seconds ? "second" : "minute").format(time);
export const dateTime = (time: number) => formatter("date").format(time);
export function ago(time: number | null) {
  if (!time) return t("Not received");
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return seconds < 60
    ? t("{n}s ago", { n: seconds })
    : seconds < 3600
      ? t("{n} min ago", { n: Math.floor(seconds / 60) })
      : t("{n}h ago", { n: Math.floor(seconds / 3600) });
}
export function safeRead<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function safeWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be unavailable in private mode. */
  }
}
