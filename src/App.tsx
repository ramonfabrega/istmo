import { useViewerPresence } from "./presence";
import {
  subscribeReports,
  refreshReports,
  type ReportSnapshot,
} from "./report-feed";
import { t, useLocale, setLocale, type Locale } from "./i18n";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  BellOff,
  Volume2,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock,
  Globe2,
  Info,
  Layers,
  Radio,
  RefreshCw,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import type { Report, Source, Station } from "../shared/types";
import { ago, api, dateTime, localTime, safeRead, safeWrite } from "./api";
import { magnitudeColor } from "./appearance";
import Globe from "./Globe";
import Waveform from "./Waveform";
import Family from "./Family";
import Notifications from "./Notifications";
import { syncPushLocale, usePushNotifications } from "./push-notifications";
import ServiceHealth from "./ServiceHealth";
import CircleMap from "./CircleMap";
import { InstallButton, UpdateNotice } from "./AppLifecycle";
import { savedCircles, type CircleSession } from "./circles";
import { useReportSound } from "./report-sound";
const demoMode =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("demo") === "1";

type View = "observatory" | "people" | "sources";
export default function App() {
  useViewerPresence();
  const locale = useLocale();
  const sound = useReportSound();
  const push = usePushNotifications();
  useEffect(() => {
    const sync = () => {
      void syncPushLocale().catch(() => {});
    };
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [locale]);
  const [circleSession, setCircleSession] = useState<CircleSession | null>(
    null,
  );
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setShowInfo(false);
        setShowNotifications(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const toggleCircle = () => {
    setSelected(null);
    if (circleSession) {
      setCircleSession(null);
      return;
    }
    const sessions = savedCircles();
    const session =
      sessions.find((s) => s.id === safeRead("istmo-active-circle", "")) ||
      sessions[0];
    if (session) setCircleSession(session);
    else setView("people");
  };
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(location.hash.slice(1)).has("invite")
      ? "people"
      : "observatory",
  );
  const [reports, setReports] = useState<Report[]>(() =>
    safeRead("istmo-reports", []),
  );
  const [sources, setSources] = useState<Source[]>(() =>
    safeRead("istmo-sources", []),
  );
  const [stations, setStations] = useState<Station[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    report: Report;
    nonce: number;
  } | null>(null);
  const [stationId, setStationId] = useState("");
  const [hours, setHours] = useState(24);
  const [magnitude, setMagnitude] = useState(0);
  const [source, setSource] = useState("all");
  const [scope, setScope] = useState("panama");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [revisions, setRevisions] = useState<
    Array<{ revision: number; observed_at: number; payload: string }>
  >([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [sourceSection, setSourceSection] = useState<
    "agencies" | "stations" | "about"
  >("agencies");
  const [showInfo, setShowInfo] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  useEffect(() => {
    const invitation = () => {
      if (new URLSearchParams(location.hash.slice(1)).has("invite"))
        setView("people");
    };
    window.addEventListener("hashchange", invitation);
    return () => window.removeEventListener("hashchange", invitation);
  }, []);
  const focusReport = (report: Report) => {
    setCircleSession(null);
    setSelected(report);
    setView("observatory");
    setActivityOpen(false);
    setFocusRequest({ report, nonce: Date.now() });
  };
  const query = { hours, magnitude, scope };
  const receiveReports = (result: ReportSnapshot) => {
    setReports(result.reports);
    setSources(result.sources);
    safeWrite("istmo-reports", result.reports);
    safeWrite("istmo-sources", result.sources);
    setOffline(false);
    setError("");
    setBusy(false);
  };
  const reportError = () => {
    setOffline(true);
    setError(t("Connection unavailable. Showing saved reports."));
    setBusy(false);
  };
  const refresh = async () => {
    setBusy(true);
    try {
      await refreshReports(query);
    } catch {
      /* Subscription shows the error. */
    }
  };
  useEffect(() => {
    setBusy(true);
    return subscribeReports(query, receiveReports, reportError);
  }, [hours, magnitude, scope]);
  useEffect(() => {
    let active = true;
    let pending = false;
    const refreshStations = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const next = await api<Station[]>("/api/stations", {
          signal: AbortSignal.timeout(10000),
        });
        if (active) setStations(next);
      } catch {
        /* Reports own the connection indicator. */
      } finally {
        pending = false;
      }
    };
    void refreshStations();
    const timer = setInterval(() => void refreshStations(), 60000);
    document.addEventListener("visibilitychange", refreshStations);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshStations);
    };
  }, []);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!selected) {
      setRevisions([]);
      return;
    }
    void api<typeof revisions>(
      `/api/reports/${encodeURIComponent(selected.id)}/revisions`,
    )
      .then(setRevisions)
      .catch(() => setRevisions([]));
  }, [selected?.id]);
  const filtered = useMemo(
    () =>
      reports.filter(
        (r) =>
          (source === "all" || r.source === source) &&
          r.magnitude >= magnitude &&
          r.occurred_at >= clock - hours * 3600000 &&
          (scope === "world" ||
            (r.latitude >= 5 &&
              r.latitude <= 11 &&
              r.longitude >= -84 &&
              r.longitude <= -76)),
      ),
    [reports, source, magnitude, hours, scope, Math.floor(clock / 30000)],
  );
  const visibleStations = stations.filter((s) => s.mode === "live" || demoMode);
  const station =
    visibleStations.find((s) => s.id === stationId) || visibleStations[0];
  return (
    <div className="app">
      <aside className="rail">
        <a className="brand" href="/" aria-label={t("Istmo home")}>
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="16" />
            <path d="M2 21h9l4-7 4 14 5-19 4 12h10" />
          </svg>
          <span>istmo</span>
        </a>
        <nav aria-label={t("Main navigation")}>
          <button
            className={
              view === "observatory" && !activityOpen ? "selected" : ""
            }
            onClick={() => {
              setView("observatory");
              setActivityOpen(false);
            }}
          >
            <Globe2 />
            <span>{t("Observe")}</span>
          </button>
          <button
            className={`activity-nav ${view === "observatory" && activityOpen ? "selected" : ""}`}
            onClick={() => {
              setView("observatory");
              setActivityOpen(true);
            }}
          >
            <Activity />
            <span>{t("Activity")}</span>
          </button>
          <button
            className={view === "people" ? "selected" : ""}
            onClick={() => setView("people")}
          >
            <Users />
            <span>{t("People")}</span>
          </button>
          <button
            className={view === "sources" ? "selected" : ""}
            onClick={() => setView("sources")}
          >
            <Layers />
            <span>{t("Sources")}</span>
          </button>
        </nav>
        <button
          className="about-button"
          aria-label={t("About Istmo")}
          onClick={() => setShowInfo(true)}
        >
          <Info size={20} />
        </button>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="region">
            <span className="small-logo">istmo</span>
            <span>{t("Panama")}</span>
            <ChevronRight size={13} />
            <span className="muted">
              {view === "observatory"
                ? t("Observatory")
                : view === "people"
                  ? t("Family circle")
                  : t("Data sources")}
            </span>
          </div>
          <div className="topbar-right">
            <select
              className="language-picker"
              aria-label={t("Language")}
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              <option value="es">ES</option>
              <option value="en">EN</option>
            </select>
            <button
              className={`notification-button ${sound.preferred || push.enabled ? "notifications-on" : ""} ${sound.preferred && !sound.enabled ? "sound-paused" : ""}`}
              title={`${t("Sound")}: ${t(sound.preferred ? "On" : "Off")} · ${t("Device notifications")}: ${t(push.enabled ? "On" : "Off")}`}
              aria-label={t("Notification preferences")}
              onClick={() => setShowNotifications(true)}
            >
              {push.enabled ? (
                <Bell size={16} />
              ) : sound.preferred ? (
                <Volume2 size={16} />
              ) : (
                <BellOff size={16} />
              )}
              {push.enabled && sound.preferred && (
                <Volume2 size={9} className="sound-badge" />
              )}
            </button>
            <span className="local-clock">
              <Clock size={13} />
              {localTime(clock)} <small>UTC−5</small>
            </span>
            {import.meta.env.DEV && (
              <span className="local-tag">
                {demoMode ? t("Replay demo") : t("Local workspace")}
              </span>
            )}
          </div>
        </header>
        {offline && (
          <div className="connection-banner">
            <WifiOff size={15} />
            {error}
            <button onClick={() => void refresh()}>{t("Retry")}</button>
          </div>
        )}
        <main
          hidden={view !== "observatory"}
          className={`observatory ${activityOpen ? "activity-open" : ""}`}
        >
          <div className="visual-column">
            <CircleMap
              session={circleSession}
              onClose={() => setCircleSession(null)}
            >
              {(layer) => (
                <Globe
                  circle={layer}
                  onCircleToggle={toggleCircle}
                  onDismiss={() => setSelected(null)}
                  reports={layer ? [] : filtered}
                  stations={visibleStations}
                  selected={selected}
                  onSelect={setSelected}
                  focusRequest={focusRequest}
                  onStation={(s) => setStationId(s.id)}
                />
              )}
            </CircleMap>
            {station && <Waveform station={station} />}
            <button
              className="latest-ticker"
              onClick={() => {
                if (matchMedia("(max-width:760px)").matches)
                  setActivityOpen(true);
                else if (filtered[0]) focusReport(filtered[0]);
              }}
              aria-label={t("Open recent activity")}
            >
              <span className="ticker-label">
                <Activity size={14} />
                {t("Latest report")}
              </span>
              {filtered[0] ? (
                <>
                  <b style={{ color: magnitudeColor(filtered[0].magnitude) }}>
                    M {filtered[0].magnitude.toFixed(1)}
                  </b>
                  <span className="ticker-place">
                    {filtered[0].place.replace(/^Localizado en /, "")}
                  </span>
                  <time>{ago(filtered[0].occurred_at)}</time>
                </>
              ) : (
                <span>{t("No reports in this view")}</span>
              )}
              <ChevronRight size={16} />
            </button>
          </div>
          <aside className="activity-panel">
            <div className="activity-heading">
              <div>
                <span className="eyeline">{t("Published observations")}</span>
                <h2>
                  {t("Recent activity")} <span>{filtered.length}</span>
                </h2>
              </div>
              <button
                aria-label={t("Refresh earthquake reports")}
                className={busy ? "spinning" : ""}
                onClick={() => void refresh()}
              >
                <RefreshCw size={16} />
              </button>
            </div>
            <div className="filters">
              <select
                aria-label={t("Report time range")}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                <option value={1}>{t("Past hour")}</option>
                <option value={6}>{t("Past 6 hours")}</option>
                <option value={24}>{t("Past 24 hours")}</option>
                <option value={168}>{t("Past 7 days")}</option>
              </select>
              <select
                aria-label={t("Minimum magnitude")}
                value={magnitude}
                onChange={(e) => setMagnitude(Number(e.target.value))}
              >
                <option value={0}>{t("All magnitudes")}</option>
                <option value={3}>M 3+</option>
                <option value={4}>M 4+</option>
                <option value={5}>M 5+</option>
                <option value={6}>M 6+</option>
              </select>
            </div>
            <div className="source-tabs">
              <button
                className={source === "all" ? "active" : ""}
                onClick={() => setSource("all")}
              >
                {t("All sources")}
              </button>
              <button
                className={source === "up" ? "active" : ""}
                onClick={() => setSource("up")}
              >
                UP
              </button>
              <button
                className={source === "usgs" ? "active" : ""}
                onClick={() => setSource("usgs")}
              >
                USGS
              </button>
              <select
                aria-label={t("Geographic scope")}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="panama">{t("Panama")}</option>
                <option value="world">{t("World")}</option>
              </select>
            </div>
            <p className="report-note">
              {t("Agency reports, not unique event counts.")}
            </p>
            <div className="event-list">
              {filtered.length ? (
                filtered.map((r) => (
                  <button
                    className={`event-row ${selected?.id === r.id ? "active" : ""}`}
                    key={r.id}
                    onClick={() => focusReport(r)}
                  >
                    <span
                      className={`magnitude ${r.magnitude >= 5 ? "large" : ""}`}
                      style={{ color: magnitudeColor(r.magnitude) }}
                    >
                      {r.magnitude.toFixed(1)}
                      <small>{r.magnitude_type || "M"}</small>
                    </span>
                    <span className="event-content">
                      <strong>{r.place.replace(/^Localizado en /, "")}</strong>
                      <span>
                        <time title={dateTime(r.occurred_at)}>
                          {ago(r.occurred_at)}
                        </time>{" "}
                        <i /> {localTime(r.occurred_at)}
                      </span>
                      <small>
                        <b>{r.source === "up" ? "UP" : "USGS"}</b> ·{" "}
                        {t(r.status)}
                        {r.revision > 1
                          ? t(" · revision {count}", { count: r.revision })
                          : ""}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <Activity size={28} />
                  <h3>{t("No reports in this view")}</h3>
                  <p>
                    {sources.some((s) => s.last_success)
                      ? t("Try a wider time range or lower magnitude.")
                      : t(
                          "The collector has not received data yet. Source health is available in Sources.",
                        )}
                  </p>
                  <button
                    onClick={() => {
                      setMagnitude(0);
                      setHours(168);
                    }}
                  >
                    {t("Widen filters")}
                  </button>
                </div>
              )}
            </div>
            <footer className="source-summary">
              {sources.map((s) => (
                <span key={s.id}>
                  <i
                    className={`dot ${s.error || !s.last_success || clock - s.last_success > 180000 ? "amber" : "teal"}`}
                  />
                  {s.id.toUpperCase()}{" "}
                  <b>
                    {s.last_success ? ago(s.last_success) : t("Awaiting data")}
                  </b>
                </span>
              ))}
            </footer>
          </aside>
        </main>
        {view === "people" ? (
          <Family
            onShowMap={(session) => {
              setFocusRequest(null);
              setCircleSession(session);
              setSelected(null);
              setActivityOpen(false);
              setView("observatory");
            }}
          />
        ) : view === "sources" ? (
          <main className="sources-page">
            <header className="sources-heading">
              <span className="eyeline">{t("Data connections")}</span>
              <h1>{t("Sources.")}</h1>
              <p>
                {t(
                  "Agency reports, collection health, and connected stations.",
                )}
              </p>
            </header>
            <nav className="source-sections" aria-label={t("Source sections")}>
              {(["agencies", "stations", "about"] as const).map((section) => (
                <button
                  key={section}
                  aria-pressed={sourceSection === section}
                  className={sourceSection === section ? "active" : ""}
                  onClick={() => setSourceSection(section)}
                >
                  {section === "agencies"
                    ? t("Agencies")
                    : section === "stations"
                      ? t("Stations")
                      : t("Reading the data")}
                </button>
              ))}
            </nav>
            <div className="sources-content">
              {sourceSection === "agencies" && (
                <div className="source-cards">
                  <ServiceHealth />
                  {sources.map((s) => (
                    <article key={s.id}>
                      <div className="source-card-title">
                        <Layers />
                        <h2>{s.name}</h2>
                        <span className={`badge ${s.error ? "warning" : ""}`}>
                          {s.error
                            ? t("Collection issue")
                            : s.last_success
                              ? clock - s.last_success > 180000
                                ? t("Delayed")
                                : t("Connected")
                              : t("Waiting")}
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>{t("Last successful collection")}</dt>
                          <dd>
                            {s.last_success ? (
                              <time title={dateTime(s.last_success)}>
                                {ago(s.last_success)} ·{" "}
                                {localTime(s.last_success)}
                              </time>
                            ) : (
                              t("Not yet collected")
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("Last attempt")}</dt>
                          <dd>
                            {s.last_attempt ? dateTime(s.last_attempt) : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("Reports in latest response")}</dt>
                          <dd>{s.report_count}</dd>
                        </div>
                      </dl>
                      {s.error && <p className="inline-error">{s.error}</p>}
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {t("Open original source")} <ArrowUpRight size={15} />
                      </a>
                    </article>
                  ))}
                </div>
              )}
              {sourceSection === "stations" && (
                <section className="station-section">
                  <h2 className="stations-title">{t("Station network")}</h2>
                  {visibleStations.length === 0 && (
                    <p className="station-empty">
                      {t("No live stations connected yet.")}
                    </p>
                  )}
                  {visibleStations.map((s) => (
                    <article className="station-card" key={s.id}>
                      <Radio />
                      <div>
                        <h3>
                          {s.name} <span className="badge">{t(s.mode)}</span>
                        </h3>
                        <p>{s.description}</p>
                        <small>
                          {s.latitude.toFixed(4)}°, {s.longitude.toFixed(4)}
                          {t("° · Last received")} {ago(s.last_received)}
                        </small>
                      </div>
                      <button
                        onClick={() => {
                          setStationId(s.id);
                          setActivityOpen(false);
                          setView("observatory");
                        }}
                      >
                        {t("View signal")}
                      </button>
                    </article>
                  ))}
                </section>
              )}
              {sourceSection === "about" && (
                <div className="method-note">
                  <h3>{t("Reading the data")}</h3>
                  <p>
                    {t(
                      "UP local times are interpreted in America/Panama (UTC−5). USGS timestamps are converted for display. Reports from different agencies are shown independently rather than automatically merged. UP does not expose a stable event ID in its table; origin-time changes can appear as separate reports.",
                    )}
                  </p>
                  <p>
                    {t(
                      "Country outlines are bundled for offline use. Your location, when enabled, stays on your device unless you choose to share a check-in snapshot with your circle. It is separate from sensor stations.",
                    )}
                  </p>
                </div>
              )}
            </div>
            <footer className="panel-footer">
              {t("Reports keep their agency’s values and revisions.")}
            </footer>
          </main>
        ) : null}
        <UpdateNotice />
      </div>
      {showNotifications && (
        <Notifications
          sound={sound}
          push={push}
          close={() => setShowNotifications(false)}
        />
      )}{" "}
      {selected && view === "observatory" && (
        <div
          className="detail-sheet"
          role="dialog"
          aria-modal="false"
          aria-labelledby="event-title"
        >
          <button
            className="close"
            aria-label={t("Close event details")}
            onClick={() => setSelected(null)}
          >
            <X size={18} />
          </button>
          <span className="eyeline">
            {selected.source === "up" ? "Geociencias UP" : "USGS"} ·{" "}
            {t(selected.status)}
          </span>
          <div
            className="detail-mag"
            style={{ color: magnitudeColor(selected.magnitude) }}
          >
            {selected.magnitude.toFixed(1)}
            <span>{selected.magnitude_type || t("Magnitude")}</span>
          </div>
          <h2 id="event-title">
            {selected.place.replace(/^Localizado en /, "")}
          </h2>
          <dl>
            <div>
              <dt>{t("Occurred")}</dt>
              <dd>
                {ago(selected.occurred_at)}
                <br />
                {dateTime(selected.occurred_at)} {t("· Panama")}
              </dd>
            </div>
            <div>
              <dt>{t("Depth")}</dt>
              <dd>{selected.depth} km</dd>
            </div>
            <div>
              <dt>{t("Coordinates")}</dt>
              <dd>
                {selected.latitude.toFixed(3)}, {selected.longitude.toFixed(3)}
              </dd>
            </div>
            <div>
              <dt>{t("First received")}</dt>
              <dd>{dateTime(selected.first_seen)}</dd>
            </div>
          </dl>
          <a
            className="source-link"
            href={selected.url}
            target="_blank"
            rel="noreferrer"
          >
            {t("View source report")} <ArrowUpRight size={15} />
          </a>
          {revisions.length > 0 && (
            <details>
              <summary>
                {t("Recorded revisions: {count}", { count: revisions.length })}
              </summary>
              {revisions.map((r) => {
                const p = JSON.parse(r.payload);
                return (
                  <p key={r.revision}>
                    #{r.revision} · M{p.magnitude} · {p.depth} km
                    <br />
                    <small>{dateTime(r.observed_at)}</small>
                  </p>
                );
              })}
            </details>
          )}
        </div>
      )}
      {showInfo && (
        <div className="modal-backdrop" onClick={() => setShowInfo(false)}>
          <section
            role="dialog"
            aria-modal="true"
            className="about-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label={t("Close about")}
              onClick={() => setShowInfo(false)}
            >
              <X size={18} />
            </button>
            <Activity size={32} />
            <h2>{t("A window into the ground.")}</h2>
            <p>
              {t(
                "Istmo brings station readings, earthquake reports, and your people into one place.",
              )}
            </p>
            <p>
              {t(
                "Earthquake reports come from the named agencies. Sensor readings appear only when a station is connected. Your location is optional and stays on your device unless you share a check-in snapshot with your circle.",
              )}
            </p>
            <p>
              {t(
                "Circle members and the service operator can read shared check-ins. History is kept until removed by the operator; shared coordinates can be cleared in People → Manage. Location pins disappear from the map after 24 hours, but remain in history until cleared. Access is saved on this device: clearing browser data loses it. Ask for a new invitation to rejoin; owner recovery is not yet available.",
              )}
            </p>
            {demoMode && (
              <p>
                {t(
                  "Demo mode shows a historical German waveform at a demonstration location in Panama. This is not local ground motion.",
                )}
              </p>
            )}
            <p>
              {t(
                "To install on your phone, open Istmo in Safari or Chrome and add it to your Home Screen. Enable notifications from the bell to receive reports when the app is closed.",
              )}
            </p>
            <p>
              {t(
                "An anonymous, temporary session heartbeat helps us estimate active viewers. It includes no identity or location and expires after 90 seconds of inactivity.",
              )}
            </p>
            <InstallButton />
            <button onClick={() => location.reload()}>
              {t("Reload Istmo")}
            </button>
            <button className="primary" onClick={() => setShowInfo(false)}>
              <Check size={15} />
              {t("Got it")}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
