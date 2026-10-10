import { reconcileUP, newReportTime, type StoredReport } from "./catalog";
import type { Env } from "./env";
import { parseUP, parseUSGS, type ParsedReport } from "./parsers";
import { enqueueReport, drainPush } from "./push";
export const sourceUrls = {
  up: "https://sismosgeociencias.up.ac.pa/",
  usgs: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
};
export async function digest(value: string) {
  const b = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function storeReports(
  env: Env,
  source: "up" | "usgs",
  raw: string,
) {
  const now = Date.now(),
    reports = source === "up" ? parseUP(raw) : parseUSGS(JSON.parse(raw));
  await env.ARCHIVE.put(
    `sources/${source}/${now}.${source === "up" ? "html" : "json"}`,
    raw,
  );
  const oldest =
    Math.min(Date.now(), ...reports.map((r) => r.occurred_at)) - 5000;
  const sourceState = await env.DB.prepare(
    "SELECT last_success FROM sources WHERE id=?",
  )
    .bind(source)
    .first<{ last_success: number | null }>();
  const stored = (
    await env.DB.prepare(
      "SELECT * FROM reports WHERE source=? AND occurred_at>=?",
    )
      .bind(source, oldest)
      .all<StoredReport>()
  ).results;
  const byId = new Map(stored.map((r) => [r.id, r]));
  const plan =
    source === "up"
      ? reconcileUP(reports, stored)
      : {
          rows: reports.map((report) => ({
            report,
            previous: byId.get(`${source}:${report.source_id}`),
          })),
          withdrawn: [],
        };
  const writes: D1PreparedStatement[] = [];
  const changed: { report: ParsedReport; id: string }[] = [];
  for (const { report: r, previous } of plan.rows) {
    const id = previous?.id ?? `${source}:${r.source_id}`;
    const fingerprint = await digest(JSON.stringify(r));
    if (previous?.fingerprint === fingerprint) {
      if (previous.withdrawn_at !== null)
        writes.push(
          env.DB.prepare(
            "UPDATE reports SET withdrawn_at=NULL WHERE id=?",
          ).bind(id),
        );
      continue;
    }
    const revision = (previous?.revision || 0) + 1;
    writes.push(
      env.DB.prepare(
        "INSERT INTO reports(id,source,source_id,occurred_at,latitude,longitude,depth,magnitude,magnitude_type,place,status,url,first_seen,updated_at,revision,fingerprint,new_report_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET occurred_at=excluded.occurred_at,latitude=excluded.latitude,longitude=excluded.longitude,depth=excluded.depth,magnitude=excluded.magnitude,magnitude_type=excluded.magnitude_type,place=excluded.place,status=excluded.status,url=excluded.url,updated_at=excluded.updated_at,revision=excluded.revision,fingerprint=excluded.fingerprint,withdrawn_at=NULL",
      ).bind(
        id,
        r.source,
        previous?.source_id ?? r.source_id,
        r.occurred_at,
        r.latitude,
        r.longitude,
        r.depth,
        r.magnitude,
        r.magnitude_type,
        r.place,
        r.status,
        r.url,
        now,
        now,
        revision,
        fingerprint,
        previous
          ? null
          : newReportTime(r, sourceState?.last_success ?? null, now),
      ),
      env.DB.prepare(
        "INSERT INTO report_revisions(report_id,revision,observed_at,payload) VALUES(?,?,?,?)",
      ).bind(id, revision, now, JSON.stringify(r)),
    );
    // Corrections must not send another new-earthquake notification.
    if (
      !previous &&
      newReportTime(r, sourceState?.last_success ?? null, now) !== null
    )
      changed.push({ report: r, id });
  }
  // Upserts and withdrawals commit together, so the API never sees both versions.
  for (const p of plan.withdrawn)
    writes.push(
      env.DB.prepare("UPDATE reports SET withdrawn_at=? WHERE id=?").bind(
        now,
        p.id,
      ),
    );
  if (writes.length) await env.DB.batch(writes);
  for (const { report, id } of changed) await enqueueReport(env, report, id);
  await env.DB.prepare(
    "UPDATE sources SET last_attempt=?,last_success=?,error=NULL,report_count=? WHERE id=?",
  )
    .bind(now, now, reports.length, source)
    .run();
  await drainPush(env);
  return reports.length;
}
export async function collect(
  env: Env,
  source: "up" | "usgs",
  override?: string,
) {
  const lease = crypto.randomUUID();
  const acquired = await env.DB.prepare(
    "INSERT INTO collection_leases(source,token,expires_at) VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE collection_leases.expires_at<? RETURNING token",
  )
    .bind(source, lease, Date.now() + 10 * 60000, Date.now())
    .first();
  if (!acquired) return { source, skipped: "Collection already running" };
  try {
    let raw = override;
    if (raw === undefined) {
      const response = await fetch(sourceUrls[source], {
        headers: { "User-Agent": "Istmo/0.1 earthquake observatory" },
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
      raw = await response.text();
    }
    return { source, count: await storeReports(env, source, raw) };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Collection failed";
    await env.DB.prepare("UPDATE sources SET last_attempt=?,error=? WHERE id=?")
      .bind(Date.now(), error, source)
      .run();
    return { source, error };
  } finally {
    await env.DB.prepare(
      "DELETE FROM collection_leases WHERE source=? AND token=?",
    )
      .bind(source, lease)
      .run();
  }
}
