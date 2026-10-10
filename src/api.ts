export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, options);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const timeFormat = (seconds: boolean) =>
  new Intl.DateTimeFormat("en", {
    timeZone: "America/Panama",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(seconds ? { second: "2-digit" as const } : {}),
  });
const minuteFormat = timeFormat(false),
  secondFormat = timeFormat(true);
const dateFormat = new Intl.DateTimeFormat("en", {
  timeZone: "America/Panama",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export const localTime = (time: number, seconds = false) =>
  (seconds ? secondFormat : minuteFormat).format(time);
export const dateTime = (time: number) => dateFormat.format(time);
export function ago(time: number | null) {
  if (!time) return "Not received";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return seconds < 60
    ? `${seconds}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} min ago`
      : `${Math.floor(seconds / 3600)}h ago`;
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
