import { useSyncExternalStore } from "react";
import spanish from "./es.json";
export type Locale = "en" | "es";
export function chooseLocale(
  saved: string | null,
  languages: readonly string[],
): Locale {
  if (saved === "en" || saved === "es") return saved;
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "en" || base === "es") return base;
  }
  return "en";
}
function initialLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("istmo-language");
  } catch {}
  return chooseLocale(saved, navigator.languages);
}
let locale = initialLocale();
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export function setLocale(next: Locale) {
  locale = next;
  try {
    localStorage.setItem("istmo-language", next);
  } catch {}
  document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale);
}
export function translate(
  message: string,
  language: Locale,
  values: Record<string, string | number> = {},
) {
  const text =
    language === "es"
      ? ((spanish as Record<string, string>)[message] ?? message)
      : message;
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    String(values[key] ?? match),
  );
}
export function t(message: string, values?: Record<string, string | number>) {
  return translate(message, locale, values);
}
if (typeof document !== "undefined") document.documentElement.lang = locale;
