import { useEffect } from "react";
// One ephemeral identifier per app document; not tied to a circle or push device.
export function useViewerPresence() {
  useEffect(() => {
    const id = crypto.randomUUID();
    let pending = false;
    let lastSent = 0;
    const controller = new AbortController();
    const beat = async () => {
      if (document.hidden || pending || Date.now() - lastSent < 10000) return;
      pending = true;
      lastSent = Date.now();
      try {
        await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        });
      } catch {
        /* Counting must never interfere with reports. */
      } finally {
        pending = false;
      }
    };
    void beat();
    const timer = setInterval(() => void beat(), 30000);
    document.addEventListener("visibilitychange", beat);
    window.addEventListener("online", beat);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
      window.removeEventListener("online", beat);
    };
  }, []);
}
