import { useEffect, useState } from "react";
import { t } from "./i18n";
import { ago } from "./api";
interface Health {
  ok: boolean;
  cron: { state: string; lastRun: number | null };
  push: {
    configured: boolean;
    pending: number;
    stalled: number;
    failed: number;
    accepted: number;
  };
}
export default function ServiceHealth() {
  const [state, setState] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/health", {
          signal: AbortSignal.timeout(10000),
        });
        const data = (await response.json()) as Health;
        if (!data.cron || !data.push)
          throw new Error("Invalid health response");
        if (active) {
          setState(data);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <article className="service-health">
      <div className="source-card-title">
        <h2>{t("Service status")}</h2>
        <span className={`badge ${failed || !state?.ok ? "warning" : ""}`}>
          {t(
            failed
              ? "Health unavailable"
              : state
                ? state.ok
                  ? "All systems current"
                  : "Service needs attention"
                : "Waiting",
          )}
        </span>
      </div>
      {state && (
        <dl>
          <div>
            <dt>{t("Cron heartbeat")}</dt>
            <dd>
              {t(state.cron.state === "ok" ? "Healthy" : "Stale")} ·{" "}
              {ago(state.cron.lastRun)}
            </dd>
          </div>
          <div>
            <dt>{t("Delivery queue")}</dt>
            <dd>
              {t(
                !state.push.configured
                  ? "Not configured"
                  : state.push.stalled
                    ? "Stalled"
                    : "Healthy",
              )}{" "}
              · {t("{count} pending", { count: state.push.pending })}
            </dd>
          </div>
          <div>
            <dt>
              {t("{count} recently accepted", { count: state.push.accepted })}
            </dt>
            <dd>
              {t("{count} recently expired after attempts", {
                count: state.push.failed,
              })}
            </dd>
          </div>
        </dl>
      )}
      <small>
        {t("Provider acceptance does not confirm display on the device.")}
      </small>
    </article>
  );
}
