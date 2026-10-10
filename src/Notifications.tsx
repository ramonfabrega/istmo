import { useState } from "react";
import { Bell, X } from "lucide-react";
import { api, safeRead, safeWrite } from "./api";
import {
  magnitudeBands,
  type ReportSound,
  type SoundMode,
} from "./report-sound";
export default function Notifications({
  close,
  sound,
}: {
  close: () => void;
  sound: ReportSound;
}) {
  const [source, setSource] = useState(safeRead("istmo-push-source", "up")),
    [mag, setMag] = useState(safeRead("istmo-push-mag", 4)),
    [device, setDevice] = useState<{ id: string; token: string } | null>(
      safeRead("istmo-push-device", null),
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const supported =
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  const post = <T,>(route: string, data: unknown) =>
    api<T>("/api/push/" + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "Notifications were not allowed. You can change this in browser settings.",
        );
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      const config = await api<{ publicKey: string }>("/api/push/config");
      if (!config.publicKey)
        throw new Error("Server notification keys are not configured.");
      const key = Uint8Array.from(
        atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
        (c) => c.charCodeAt(0),
      );
      const subscription =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));
      const next = await post<{ id: string; token: string }>("subscribe", {
        subscription: subscription.toJSON(),
        source,
        minMagnitude: mag,
        token: device?.token,
      });
      setDevice(next);
      safeWrite("istmo-push-device", next);
      safeWrite("istmo-push-source", source);
      safeWrite("istmo-push-mag", mag);
      setMessage("Saved. New qualifying reports will be sent to this device.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="close"
          aria-label="Close notifications"
          onClick={close}
        >
          <X size={18} />
        </button>
        <Bell size={27} />
        <h2 id="notification-title">Notifications & sound.</h2>
        <section className="sound-settings">
          <h3>Sound while Istmo is open</h3>
          <p>
            A gentle chime for new Panama reports, including in a background
            tab. Browsers can pause background activity; use push notifications
            when the app is closed.
          </p>
          <div className="sound-filters">
            <label>
              Agency
              <select
                value={sound.source}
                onChange={(e) => sound.setSource(e.target.value)}
              >
                <option value="up">Geociencias UP</option>
                <option value="usgs">USGS</option>
              </select>
            </label>
            <label>
              Magnitude
              <select
                value={sound.magnitude}
                onChange={(e) => sound.setMagnitude(Number(e.target.value))}
              >
                {[0, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n ? `M ${n}+` : "All"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="spaced">
            Chime style
            <select
              value={sound.mode}
              onChange={(e) => sound.setMode(e.target.value as SoundMode)}
            >
              <option value="simple">Simple</option>
              <option value="magnitude">Magnitude chime</option>
            </select>
          </label>
          {sound.mode === "magnitude" && (
            <div className="magnitude-preview">
              <p>Higher pitch for stronger reports. Tap to listen:</p>
              <div
                className="magnitude-preview-grid"
                role="group"
                aria-label="Preview magnitude bands"
              >
                {magnitudeBands.map((band) => (
                  <button
                    key={band.magnitude}
                    title={`${band.note} · ${band.magnitude === 3 ? "Below M 3.5" : band.magnitude === 6.5 ? "M 6.5 and above" : `M ${band.magnitude}–${(band.magnitude + 0.49).toFixed(2)}`}`}
                    aria-label={`Preview magnitude ${band.magnitude.toFixed(1)}`}
                    onClick={() =>
                      void sound.preview(band.magnitude, "magnitude")
                    }
                  >
                    <span>
                      M {band.magnitude.toFixed(1)}
                      {band.magnitude === 6.5 ? "+" : ""}
                    </span>
                    <small>{band.note}</small>
                  </button>
                ))}
              </div>
              <p>
                <small>
                  Below M3 uses the lowest tone; M6.5+ uses the highest. If
                  reports arrive together, one chime represents the strongest.
                  Previews don’t enable alerts.
                </small>
              </p>
            </div>
          )}
          <div className="status-options">
            <button
              className={sound.enabled ? "" : "primary"}
              onClick={() =>
                sound.enabled ? sound.disable() : void sound.enable()
              }
            >
              {sound.enabled
                ? "Turn sound off"
                : sound.preferred
                  ? "Resume sound"
                  : "Enable sound"}
            </button>
            <button onClick={() => void sound.test()}>Test sound</button>
          </div>
          <small role="status">
            {sound.message ||
              (sound.preferred
                ? "Tap Resume after reopening the app to allow audio."
                : "Off by default. Enabling plays a preview.")}
          </small>
        </section>
        <h3>Push notifications</h3>
        <p>
          Choose one agency for notifications to avoid duplicate reports from
          different sources. Coverage: Panama and nearby waters.
        </p>
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="up">Geociencias UP</option>
            <option value="usgs">USGS</option>
          </select>
        </label>
        <label className="spaced">
          Minimum magnitude
          <select value={mag} onChange={(e) => setMag(Number(e.target.value))}>
            {[3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                M {n}+
              </option>
            ))}
          </select>
        </label>
        {!supported && (
          <p className="inline-error">
            Open the private HTTPS address. On iPhone, add Istmo to your Home
            Screen and open it there to enable notifications.
          </p>
        )}
        <div className="status-options">
          <button
            className="primary"
            disabled={!supported || busy}
            onClick={() => void enable()}
          >
            {device ? "Save preferences" : "Enable notifications"}
          </button>
          {device && (
            <>
              <button
                disabled={busy}
                onClick={async () => {
                  try {
                    await post("test", device);
                    setMessage(
                      "Test queued. A push-service acknowledgment is not confirmation that your phone displayed it.",
                    );
                  } catch (e) {
                    setMessage(String(e));
                  }
                }}
              >
                Send a test
              </button>
              <button
                onClick={async () => {
                  try {
                    await post("unsubscribe", device);
                    const reg = await navigator.serviceWorker.ready;
                    await (
                      await reg.pushManager.getSubscription()
                    )?.unsubscribe();
                    safeWrite("istmo-push-device", null);
                    setDevice(null);
                    setMessage("Notifications disabled.");
                  } catch (e) {
                    setMessage(String(e));
                  }
                }}
              >
                Disable
              </button>
            </>
          )}
        </div>
        {message && <p role="status">{message}</p>}
        <p>
          <small>
            Published reports, not early warnings. Notifications depend on
            agency publication and device delivery. Historical imports do not
            trigger a backlog of notifications.
          </small>
        </p>
      </section>
    </div>
  );
}
