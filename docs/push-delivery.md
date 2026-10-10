# Push delivery

Source publication, Istmo collection, provider acceptance, and device receipt are
separate stages. An earthquake's origin time is not its publication time.

## Dispatch

The minute cron starts due retries immediately. UP and USGS collect independently;
each dispatches as soon as its collection completes. UP delivery no longer waits
for a slow USGS request. A report and its matching notification jobs commit in the
same D1 batch: an enqueue failure rolls back the report so collection can retry.
Fan-out inserts subscriptions in one SQL statement per report.

Each drain uses eight sending lanes, claims jobs atomically, and loads additional
pages beyond the former 25-job limit. The per-drain budget is 500 selected jobs or
20 seconds before starting another send; an in-flight send can take up to ten more
seconds. Concurrent drains may have additional lanes, but share job leases. Work
left after the budget remains in D1 for the next minute. This improves small and
moderate fan-out; it is not an unbounded-throughput guarantee. A persistently
stalled queue would justify dedicated Cloudflare Queue consumers.

Provider requests use high urgency and a TTL of at most five minutes, capped by
the job's remaining life. Urgency is a delivery hint, not a critical alert or an
OS override. Errors retain the existing bounded exponential backoff; the next
cron retries due jobs. Expired subscriptions (404/410) are removed. Provider
acceptance stops retries. There is no exactly-once guarantee across a crash after
provider acceptance but before the database write; notification tags identify the
same report on retries.

## Private diagnostics

Run `bun run delivery --production` (or omit `--production` for local).
`GET /api/push/delivery` requires `ADMIN_TOKEN` and returns up to 200 queued jobs
from the last 24 hours, with provider and an opaque device identifier. It exposes
no subscription endpoints, encryption keys, receipt capabilities, or user agents.

- `report_received_at`: collector observation timestamp, where a report exists.
- `queued_at`: notification enqueue timestamp.
- `first_attempt_at`, `last_attempt_at`: start of claimed send attempts.
- `accepted_at`: provider returned success; **not device delivery**.
- `receipt_at`: server received the service worker's acknowledgment.
- `device_received_at`: device clock when its push handler ran.
- `device_shown_at`: device clock after `showNotification()` resolved, or null
  when showing failed. This does **not** prove when a banner appeared or was seen.
- `device_kind`: coarse, best-effort platform hint, not a full user agent.

Compare server timestamps for queue and send delays. `receipt_at -
first_attempt_at` includes push delivery, notification handling, and the return
request: it is an upper bound on arrival, not an exact one-way latency. Device
clocks may differ from the server, so do not subtract device timestamps from
server timestamps as if synchronized. A very fast device can acknowledge before
our provider-response write completes.

The receipt capability is random, specific to one job, encrypted inside the push,
and retained across retries. It can only acknowledge that job once. Diagnostics
are private. Existing seven-day outbox retention also removes these fields.
Legacy jobs retain null timestamps rather than fabricated historical timings.

The service worker displays the notification before sending its best-effort
receipt, with a five-second callback timeout. Callback failure never suppresses
the notification. Missing receipts are inconclusive (old worker, network failure,
or device unavailable). The worker also asks open app clients to refresh reports;
it does not wait for the normal 15-second polling interval. Normal API caching
still applies. No persistent live connection is required for background push.

## Verification

Regression tests first reproduced cross-source blocking, sequential-device
blocking, and the report/enqueue transaction gap. Tests now cover those cases,
130-job fan-out with an eight-send bound, simultaneous claims, provider errors and
retries, TTL bounds, receipt authorization/replay, private diagnostics, and service
worker display/acknowledgment behavior including offline callbacks.

Production deployment applies migration 0010 before the Worker update. Receipt
tracking requires the updated service worker; opening/reloading each installed app
allows it to update. To compare Firefox, the Dock app, and a phone, send a test
from each, then inspect diagnostics. This tests the transport without inventing
an earthquake. The existing test button allows one queued test per device/minute.
Actual OS banner timing still needs a human observation.
