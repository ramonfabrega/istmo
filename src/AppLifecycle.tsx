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
  return (
    <div className="install-control">
      <button onClick={() => void install()}>
        <Download size={15} />
        Install Istmo
      </button>
      {help && (
        <div className="install-help" role="status">
          <p>
            <strong>iPhone / iPad:</strong> open Safari’s Share menu (it may be
            under •••), choose <strong>Add to Home Screen</strong>, keep{" "}
            <strong>Open as Web App</strong> on if shown, then tap{" "}
            <strong>Add</strong>.
          </p>
          <p>
            On other browsers, use the install icon in the address bar or the
            browser menu. Open the installed app to enable phone notifications.
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
      <span>A new Istmo is ready.</span>
      <button onClick={() => location.reload()}>
        <RefreshCw size={14} />
        Reload
      </button>
      <button aria-label="Later" onClick={() => setDismissed(true)}>
        <X size={15} />
      </button>
    </aside>
  );
}
