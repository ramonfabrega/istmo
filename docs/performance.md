# Report freshness and performance

## Why a banner could precede the UI

Push and UI polling are separate paths. A push-triggered UI refresh could previously
reuse a request started before the report committed, or receive a pre-report edge
snapshot still inside its five-second TTL. With the normal 15-second poll cadence,
that could leave the UI behind an already-delivered banner. Dock activation also
needed a focus handler, since activation does not always change document visibility.

Push payloads now include `catalogAfter`, a server timestamp captured after selecting
and claiming the committed notification job. The service worker sends this freshness
hint to open clients. The report API rejects snapshots and in-flight loads started
at or before that timestamp. It keeps the same canonical cache key so sufficiently
fresh snapshots can still be shared. Freshness hints are bounded by server time.

The shared client feed invalidates an in-flight result and performs one immediate
follow-up. It does not publish that superseded result. Push/activation listeners
are shared between map and sound subscribers and removed when the feed is unused.
Focus, visible-tab resume, online recovery, manual refresh, and back/forward-cache
restoration request a fresh snapshot. Background polling still pauses when unused.

Cache writes are ordered within an isolate so a slow old write cannot replace a
newer snapshot. Cross-isolate freshness still relies on the explicit timestamp
check. Normal periodic polling retains the five-second public cache. This fixes
avoidable waiting; it does not force a suspended OS process to run immediately.

Regression tests reproduced the client request race, stale snapshot/in-flight
reuse, and out-of-order cache writes before the changes. Additional tests exercise
Dock-style focus and map/sound sharing of the immediate follow-up.

## Observability

Production retains 10% sampled Worker logs and now explicitly enables 10% sampled
Cloudflare traces. In Cloudflare → Workers & Pages → istmo → Observability, inspect
traces for request/binding timings and filter logs by `event = public_snapshot`.
Each public snapshot log includes path, cache state, duration, snapshot age, and
load duration. Custom logs contain no query strings, report bodies, or device IDs.
Cloudflare's automatic traces can include request/outbound URL metadata; keep
access within the account. No external telemetry exporter is configured.

Public API responses expose `Server-Timing` entries:

- `app`: elapsed snapshot handler time, including cache lookup/write.
- `snapshot_age`: age of the served snapshot, not CPU time.
- `load`: snapshot loader duration for a miss/coalesced load, zero for cache hits.

These appear in browser developer tools alongside network/TTFB timing. They do not
measure network transit or browser rendering. See [Cloudflare tracing documentation](https://developers.cloudflare.com/workers/observability/traces/).

Browser-local User Timing entries (at most 50 per name) separate:

- `istmo:reports.fetch`: fetch and JSON decode.
- `istmo:reports.commit`: report receipt to React's post-commit effect.
- `istmo:reports.map_prepare`: GeoJSON/marker preparation and submission. This
  excludes asynchronous MapLibre worker/GPU rendering.

Inspect with `performance.getEntriesByType('measure').filter(x =>
x.name.startsWith('istmo:'))` in Chrome DevTools or Safari Web Inspector. These
measurements stay on the device and do not create telemetry network requests.
For push transport timestamps, see [push delivery](push-delivery.md).

## Local profile — October 10, 2026

An isolated Chrome 154 browser on the development Mac, with 146 reports and an
809 × 1185 map canvas, was measured while visible. Tests used real local data and
no invented earthquake notifications. The production frontend was served on
loopback with the local API; these are not WAN or Safari Dock measurements.

Development mode initially showed ~90 ms tasks at the one-second clock interval.
An eight-second CPU profile attributed most sampled application work to React's
`jsxDEV` runtime. Repeating with the production frontend found:

- No >50 ms long tasks in the eight-second observation.
- Frame interval p95: 11.5 ms on this display.
- Representative report fetches: 11–16 ms against the local API.
- React post-commit measurements: 2.4–4 ms.
- Map preparation: 0.1–0.4 ms.

A simulated push refresh signal in that local production UI fetched in 8.4 ms,
committed in 4.5 ms, and prepared map data in 0.1 ms. The API served a fresh
snapshot (3 ms old) instead of waiting for the next polling interval.

This does not support rewriting the renderer to fix the multi-second stale-data
symptom. Safari/device-specific profiling remains useful if a lag persists after
the freshness fix. A short sample does not establish performance on all devices.

A separate local burst of 50 simultaneous reads had zero errors: normal reads
p95 ~101 ms (47 hits, 2 coalesced, 1 miss), forced-fresh reads p95 ~95 ms (49 coalesced,
1 miss). This is a small concurrency check, not a production capacity guarantee.
