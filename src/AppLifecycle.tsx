import { t } from "./i18n";
import { installGuide } from "./install-guide";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, RefreshCw, X } from "lucide-react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Capture the browser event at startup, even when the install button is hidden
// inside a panel. Browsers may only fire it once per page load.
let installPrompt: InstallPrompt | null = null;
const installListeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as InstallPrompt;
  installListeners.forEach((listener) => listener());
});
function subscribeInstall(listener: () => void) {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}
export function InstallButton() {
  const prompt = useSyncExternalStore(subscribeInstall, () => installPrompt);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(
    () =>
      matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  );
  useEffect(() => {
    const done = () => setInstalled(true);
    window.addEventListener("appinstalled", done);
    return () => window.removeEventListener("appinstalled", done);
  }, []);
  if (installed) return null;
  async function install() {
    if (!prompt) {
      setHelp(!help);
      return;
    }
    try {
      await prompt.prompt();
      const result = await prompt.userChoice;
      if (result.outcome === "accepted") setInstalled(true);
    } finally {
      installPrompt = null;
      installListeners.forEach((listener) => listener());
    }
  }
  const guide = installGuide(navigator);
  return (
    <div className="install-control">
      <button onClick={() => void install()} aria-expanded={help}>
        <Download size={15} />
        {t("Install Istmo")}
      </button>
      {help && (
        <div className="install-help" role="status">
          <strong>{t(guide.title)}</strong>
          <p>{t(guide.instructions)}</p>
          <p>
            {t(
              "After installing, open Istmo from its app icon and enable notifications from the bell.",
            )}
          </p>
        </div>
      )}
    </div>
  );
}

// Compare the running entry bundle with the deployed shell. No forced reloads:
// someone may be writing a check-in or reviewing an incident when we deploy.
export function UpdateNotice() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const running = document
      .querySelector<HTMLScriptElement>('script[type="module"][src]')
      ?.getAttribute("src");
    if (!running) return;
    let stopped = false;
    let checking = false;
    let lastCheck = 0;
    async function check() {
      if (document.hidden || checking || Date.now() - lastCheck < 60000) return;
      checking = true;
      lastCheck = Date.now();
      try {
        const response = await fetch("/", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return;
        const document = new DOMParser().parseFromString(
          await response.text(),
          "text/html",
        );
        const deployed = document
          .querySelector('script[type="module"][src]')
          ?.getAttribute("src");
        if (!stopped && deployed && deployed !== running) setAvailable(true);
        void navigator.serviceWorker
          ?.getRegistration()
          .then((registration) => registration?.update())
          .catch(() => {});
      } catch {
        /* Offline: keep the current app usable. */
      } finally {
        checking = false;
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), 5 * 60000);
    const resume = () => void check();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, []);
  if (!available || dismissed) return null;
  return (
    <aside className="update-notice" role="status">
      <span>{t("A new Istmo is ready.")}</span>
      <button onClick={() => location.reload()}>
        <RefreshCw size={14} />
        {t("Reload")}
      </button>
      <button aria-label={t("Later")} onClick={() => setDismissed(true)}>
        <X size={15} />
      </button>
    </aside>
  );
}
