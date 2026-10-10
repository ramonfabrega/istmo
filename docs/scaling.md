# Capacity, freshness, and private viewers

## Public snapshots

Reports and station lists use the Workers Cache API with a five-second TTL. Cache keys normalize query parameters and ignore unknown parameters. Only these two public endpoints are cached; circles, credentials, subscriptions, health, and the viewer count remain uncached. Responses sent to browsers are `no-store`, so there is no second browser-cache delay.

The snapshot timestamp is captured before the database queries. An explicit age check rejects snapshots at five seconds, even if the edge still holds the entry. Failed loads are never cached and expired entries are not served as a success during an outage. Concurrent misses share one load within a Worker isolate. Separate isolates and Cloudflare locations can still make independent loads; this is not a global database-query lock. Cache failures fall back to database reads.

The map and sound share a 15-second polling feed when their queries match (the default Panama / 24 hours / all magnitudes view). Different map filters need a separate query to preserve sound's independent agency/magnitude selection. Stations refresh every minute. Hidden pages stop report polling unless sound is running; returning online or to the foreground refreshes reports immediately. In-flight requests are shared and responses from old, unsubscribed filters cannot overwrite the new view.

Nominal database-to-active-viewer delay is at most about 20 seconds (five-second snapshot age plus 15-second poll), plus network and query time. This is a budget, not an SLA: browsers throttle background tabs, outages delay requests, and agencies publish on their own schedules. Collection still runs every minute. Add up to about a minute plus upstream request time from agency publication to collection. Source freshness is shown separately; quiet earthquake activity never implies a broken feed. Web Push does not wait for the public cache or browser polling.

Sound tracks the snapshot generation time rather than response receipt time, so a cached baseline does not skip newly collected reports in between. Initial snapshots never sound a backlog.

Public GETs have a separate 6,000/minute/IP rate limit to allow shared Wi-Fi networks. Presence has 3,000/minute/IP. Existing private/other reads (300/minute/IP) and writes (60/minute/IP) retain their limits. These are abuse controls, not supported-capacity claims.

## Private active-viewer estimate

Visible app documents send one anonymous random session ID every 30 seconds. Hidden documents stop sending; entries expire after 90 seconds without a heartbeat. A single Durable Object deduplicates sessions in memory, with no D1 writes, cookies, location, circle IDs, or push-device IDs. IDs are not logged by application code. Requests still pass through Cloudflare's ordinary network infrastructure.

This counts sessions, not unique humans. Multiple tabs count separately, suspended phones age out, scripted traffic can inflate it, and restarts/deployments reset the estimate until clients heartbeat again. The response includes the counter start time. Memory is capped at 20,000 active sessions; at capacity, new heartbeats return 503 while report delivery continues independently. There is no historical visitor tracking or public count.

Read it locally:

```sh
bun run viewers
```

Read production:

```sh
bun run viewers --production
```

The command uses `ADMIN_TOKEN` from the environment or the corresponding ignored `.dev.vars` / `.dev.vars.production` file. It prints only aggregate counts. `GET /api/admin/viewers` requires the same admin bearer credential; hiding a UI element is not the access control. Do not put admin credentials in client code or URLs.

## Reproducible checks

With the local app running:

```sh
bun run test
bun run test:integration
bun run test:load
```

The load script refuses non-loopback hosts and requires the API's environment to be local. It tests private-counter authentication, invalid/foreign-origin heartbeats, and repeated heartbeats from 100 sessions. It then runs eight-second bursts at 25, 100, and 250 simultaneous HTTP requests, over four report/station queries. Finally it inserts a clearly named temporary local report, revises it, withdraws it, checks cache freshness after each write, and removes it in `finally`. It never creates synthetic push jobs. Temporary viewer sessions expire naturally.

### Local result — October 10, 2026

Vite/Miniflare on the Studio host, current development catalog, no network latency simulation:

| Concurrent requests | Requests | Requests/s | p50 | p95 | p99 | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 25 | 8,228 | 1,025 | 23 ms | 38 ms | 45 ms | 0 |
| 100 | 8,810 | 1,095 | 89 ms | 123 ms | 144 ms | 0 |
| 250 | 9,779 | 1,197 | 203 ms | 291 ms | 342 ms | 0 |

Across 26,817 requests: 26,317 cache hits, 480 shared concurrent loads, and 20 fresh loads. New report / revision / withdrawal appeared 4,098 / 4,527 / 4,514 ms after local writes completed. The database CLI itself takes time; these numbers measure from its completion, while unit tests separately enforce the snapshot's five-second age limit.

This exercises application code, cache expiry and local request handling, not Cloudflare's geographically distributed capacity, real mobile networks, upstream agency latency, or mass Web Push delivery. Do not convert these numbers into a promised concurrent-viewer ceiling. Before a large public launch, use an isolated Cloudflare staging deployment for sustained traffic, multiple regions, latency/CPU/D1-read measurements, and push fan-out tests. A real sensor stream also needs its own test: the current station relay deliberately caps connections at 200 per station.

The next step, if metrics justify it, is report-change fan-out through hibernating WebSockets, backed by snapshot fetch/recovery. A private presence counter alone does not require a public pub/sub service.
