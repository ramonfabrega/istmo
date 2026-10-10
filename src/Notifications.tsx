import { useEffect, useState } from "react";
import { X, Volume2, Bell } from "lucide-react";
import {
  magnitudeBands,
  type ReportSound,
  type SoundMode,
} from "./report-sound";
import { usePushNotifications } from "./push-notifications";

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      className="notification-toggle"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
    >
      <span>{checked ? "On" : "Off"}</span>
      <i aria-hidden="true" />
    </button>
  );
}
function Filters({
  source,
  magnitude,
  setSource,
  setMagnitude,
}: {
  source: string;
  magnitude: number;
  setSource: (value: string) => void;
  setMagnitude: (value: number) => void;
}) {
  return (
    <div className="sound-filters">
      <label>
        Agency
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="up">Geociencias UP</option>
          <option value="usgs">USGS</option>
        </select>
      </label>
      <label>
        Minimum magnitude
        <select
          value={magnitude}
          onChange={(e) => setMagnitude(Number(e.target.value))}
        >
          {[0, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n ? `M ${n}+` : "All"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
export default function Notifications({
  close,
  sound,
}: {
  close: () => void;
  sound: ReportSound;
}) {
  const push = usePushNotifications();
  const [previewMagnitude, setPreviewMagnitude] = useState(4);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [close]);
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="about-modal notification-panel"
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
        <h2 id="notification-title">Notifications</h2>
        <p className="notification-intro">Choose how Istmo reaches you.</p>
        <section className="notification-channel" aria-label="Sound settings">
          <div className="notification-channel-heading">
            <Volume2 size={20} />
            <div>
              <h3>Sound while open</h3>
              <p>A chime, even in another tab.</p>
            </div>
            <Toggle
              label="Sound while open"
              checked={sound.enabled}
              onChange={() =>
                sound.enabled ? sound.disable() : void sound.enable()
              }
            />
          </div>
          {!sound.enabled && sound.preferred && (
            <p className="notification-hint">
              Turn on again after reopening to allow audio.
            </p>
          )}
          <details className="notification-options">
            <summary>Sound options</summary>
            <Filters
              source={sound.source}
              magnitude={sound.magnitude}
              setSource={sound.setSource}
              setMagnitude={sound.setMagnitude}
            />
            <label>
              Chime
              <select
                value={sound.mode}
                onChange={(e) => sound.setMode(e.target.value as SoundMode)}
              >
                <option value="magnitude">Pitch follows magnitude</option>
                <option value="simple">Same tone every time</option>
              </select>
            </label>
            <div className="notification-preview">
              {sound.mode === "magnitude" && (
                <label>
                  Preview magnitude
                  <select
                    value={previewMagnitude}
                    onChange={(e) =>
                      setPreviewMagnitude(Number(e.target.value))
                    }
                  >
                    {magnitudeBands.map((b) => (
                      <option key={b.magnitude} value={b.magnitude}>
                        M {b.magnitude.toFixed(1)}
                        {b.magnitude === 6.5 ? "+" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                onClick={() => void sound.preview(previewMagnitude, sound.mode)}
              >
                Play preview
              </button>
            </div>
            <p className="notification-hint">
              Previewing doesn’t turn sound on. Browsers may pause background
              audio.
            </p>
          </details>
          {sound.message && (
            <p className="notification-feedback" role="status">
              {sound.message}
            </p>
          )}
        </section>
        <section
          className="notification-channel"
          aria-label="Device notification settings"
        >
          <div className="notification-channel-heading">
            <Bell size={20} />
            <div>
              <h3>Device notifications</h3>
              <p>Reports when Istmo is closed.</p>
            </div>
            <Toggle
              label="Device notifications"
              checked={push.enabled}
              disabled={!push.supported || push.busy}
              onChange={() =>
                void (push.enabled ? push.disable() : push.enable())
              }
            />
          </div>
          {!push.supported && (
            <p className="notification-hint">
              On iPhone, add Istmo to your Home Screen and open it there.
              Notifications need a supported browser and HTTPS.
            </p>
          )}
          <details className="notification-options">
            <summary>Notification options</summary>
            <Filters
              source={push.source}
              magnitude={push.magnitude}
              setSource={push.setSource}
              setMagnitude={push.setMagnitude}
            />
            {push.enabled && (
              <div className="notification-actions">
                <button disabled={push.busy} onClick={() => void push.enable()}>
                  Save changes
                </button>
                <button disabled={push.busy} onClick={() => void push.test()}>
                  Send test
                </button>
              </div>
            )}
          </details>
          {push.message && (
            <p className="notification-feedback" role="status">
              {push.message}
            </p>
          )}
        </section>
        <p className="notification-footer">
          Panama and nearby waters. Agency reports, not early warnings.
        </p>
      </section>
    </div>
  );
}
