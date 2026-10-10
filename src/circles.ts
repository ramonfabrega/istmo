import type { Family } from "../shared/types";
import { safeRead, safeWrite } from "./api";
export interface CircleSession {
  id: string;
  name: string;
  reporter: string;
  token: string;
}
export function savedCircles(): CircleSession[] {
  const circles = safeRead<CircleSession[]>("istmo-circles", []);
  const legacy = safeRead<string>("istmo-family-token", "");
  const cache = safeRead<Family | null>("istmo-family-cache", null);
  if (legacy && cache?.group && !circles.some((s) => s.token === legacy)) {
    circles.push({
      id: cache.group.id,
      name: cache.group.name,
      reporter: cache.member.name,
      token: legacy,
    });
    safeWrite("istmo-circles", circles);
    safeWrite(`istmo-circle:${cache.group.id}`, cache);
    // Preserve queued updates but strip incident fields on submission later.
    safeWrite(`istmo-pending:${cache.group.id}`, safeRead("istmo-pending", []));
    try {
      for (const key of [
        "istmo-family-token",
        "istmo-family-cache",
        "istmo-pending",
      ])
        localStorage.removeItem(key);
    } catch {
      /* Storage can be unavailable. */
    }
  }
  return circles;
}
export function inviteCode(value: string): string {
  const text = value.trim();
  if (/^[a-f0-9-]{72}$/i.test(text)) return text;
  try {
    const url = new URL(text);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    const code = new URLSearchParams(url.hash.slice(1)).get("invite") || "";
    return /^[a-f0-9-]{72}$/i.test(code) ? code : "";
  } catch {
    return "";
  }
}
export const invitationLink = (code: string) =>
  `${location.origin}/#invite=${encodeURIComponent(code)}`;
