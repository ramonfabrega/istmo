# Istmo

A Panama-first earthquake observatory: a navigable globe, attributed agency reports, continuous station waveforms, and a private family check-in board. Live at **https://istmo.ramonfabrega.com**. Built with React/TypeScript and Cloudflare Workers, D1, R2, and Durable Objects.

The seeded station replays **real recorded German ground motion from 2010** at a **demo Panama location**. It is available only in development at `/?demo=1`, with explicit replay labels. No physical instrument is connected. Agency reports are collected live and retain their source, revision history, and last successful collection time. The app supplies observations and communication tools; it does not make earthquake predictions or occupancy recommendations.

## Run locally

Requires Node 24 and Bun 1.3.10. Bun manages dependencies and scripts; Vite, Vitest, Wrangler and the development processes still run on Node. No Cloudflare resources need to be created.

```sh
bun install --frozen-lockfile
bun run setup
bun run dev:all
```

Open http://localhost:5173 or http://studio:5173 from a connected device. `dev:all` runs the app, real-waveform replay, and source collector together. Ctrl-C stops all three. Vite binds to `0.0.0.0`; access depends on your host firewall and network. State persists in `.wrangler/state`, and private local keys are generated in `.dev.vars` (gitignored). Never serve or upload `.dev.vars` or the server build as public assets.

To run components separately:

```sh
bun run dev
bun run replay
bun run collect --watch
```

The local collector polls each source, then waits 60 seconds. The deployed scheduler is configured for every minute; local development needs the collector process. Reports refresh in the UI every 30 seconds. Check-ins refresh every 15 seconds; waveform records arrive over a WebSocket.

### Phone / Tailscale

This workspace is currently available privately on the tailnet at:

**https://studio.bengal-barb.ts.net:8443**

The route was created with `tailscale serve --bg --https=8443 http://127.0.0.1:5173`. It uses Tailscale Serve, not public Funnel. To remove only this route: `tailscale serve --https=8443 off`.

Use the HTTPS address for installation and notifications. On iPhone, open in Safari → Share → Add to Home Screen → open the installed app. The bell opens device notification preferences; enabling is opt-in. Choose one agency and a minimum magnitude. Use **Send test** to verify that device. Actual delivery to a real phone still needs that test; a push service accepting a message does not prove the phone displayed it. The local host must stay awake and connected for collection, replay, and push delivery.

Production builds register an offline service worker automatically. In development, enabling notifications registers it. Last fetched reports and check-ins are cached separately; missing waveform data remains a gap. A pending offline family check-in stays visibly pending until explicitly sent and accepted by the server.

### Reset / migrate

`bun run db:migrate` applies new local migrations without resetting data. `bun run setup` is repeatable and seeds the demo station using `INSERT OR IGNORE`.

For a fresh scratch database and archive: stop the dev processes, **move** `.wrangler/state` to a backup folder, then run `bun run setup`. Keep `.dev.vars` if you want the same local keys. Old family sessions no longer identify members of a fresh database; use **Manage → Remove circle from this device** in People and create/join a new circle. This reset affects only local state; no remote flags are used.

## Included

- Panama-centered globe with pan/zoom, world view, magnitude markers, source/time/magnitude filters, report details and revision history. Country boundaries and a few regional city labels are bundled; no map API key or external tile service.
- University of Panama HTML collector and USGS GeoJSON collector. Raw responses archived, source-specific reports normalized and deduplicated, failures and data age exposed. Reports from two agencies are intentionally not claimed to be two unique earthquakes or automatically merged into one.
- miniSEED 2 ingestion with per-station credentials, original bytes archived in R2, idempotent sequence handling, and one Durable Object/WebSocket stream per station. Browser decoding, channel selection, 30/60/180-second windows, freeze/resume, and recent record downloads.
- Real-waveform replay through the same ingestion API. `GAP_EVERY=30 bun run replay` creates deliberate gaps. Replay source timestamps are preserved; display timestamps use the current replay timeline.
- Private invitation-based circles, timestamped “reported okay / needs help / not confirmed,” independent arrived/left records, reporter attribution, history, and explicit offline pending state. An uncle can report on a grandparent. Names are self-declared; these are family reports, not independent verification.
- Opt-in Web Push with VAPID, source/magnitude preferences, D1 outbox, bounded retries and expiry. Only recent Panama-region reports qualify; installing does not send a backlog of old earthquakes. One notification per source report per device; revisions remain in the app.

## Checks

```sh
bun run test
bun run build
# With the local dev app running:
bun run test:integration
```

Unit tests exercise the captured UP table, Panama timestamps, invalid upstream pages, USGS magnitude handling, original miniSEED headers, signed sample encoding and malformed records. Integration checks use disposable circles and the replay station: membership isolation, attribution, duplicate/conflicting submissions, persistent timelines, invitation revocation, self-only location sharing, gathering-place isolation, binary streaming, and byte-exact R2 downloads. No test notification is sent automatically.

Desktop and iOS 26.5 Simulator Safari flows were exercised over the HTTPS Tailscale route. The phone Observe view fits the viewport with bottom navigation; Activity scrolls independently. Cluster selection, report details, and expanding/collapsing the waveform were checked. Home Screen installation succeeded in the simulator; standalone launch via the automation tool was unavailable. Real-device standalone behavior/background push and physical hardware remain device tests.

## Design and next steps

See [architecture](docs/architecture.md), [station protocol](docs/stations.md), and [visual direction](docs/design.md).

Production uses its own D1 database and private R2 bucket. No local circles, replay station, or development secrets are copied. Cloudflare cron collects UP and USGS every minute without depending on the local host. API reads and writes have separate per-IP rate limits; collectors have source-specific leases and transactional catalog updates. Public raw-source snapshots expire after 30 days. Normalized report revisions and circle history are retained; members can clear their shared coordinates. Map location pins age out after 24 hours, which does not delete their historical coordinates.

For updates:

```sh
bun run test
bun run test:integration # local dev server only
bun run deploy # production build → pending D1 migrations → Worker deploy
```

Production secrets live in gitignored `.dev.vars.production` (mode 600) and Cloudflare Worker secrets. Back this file up securely; do not rotate VAPID keys casually because existing device subscriptions depend on them. `bunx wrangler secret bulk .dev.vars.production --env production` uploads them. Only `dist/client` is public; the server build includes private preview variables and must never be served as a directory. Do not run local seed/reset scripts against production.

See [deployment runbook](docs/deployment.md) for verification and resource details. Next priorities are real-device push delivery, owner recovery/new-device linking, and physical station calibration plus batched waveform storage before continuous cloud ingestion.

### Map location and development replay

The default view shows agency reports and live stations only. With no live stations, the map uses the space previously occupied by the waveform. For local waveform development, open `/?demo=1`; this explicitly includes recorded replay stations. The demo switch is disabled in production builds.

The map's **My location** arrow requests browser location permission and centers a blue position marker. If permission was already granted, the marker can appear without recentering. Location is kept only in page memory, never posted to the API or saved in local storage. Use the HTTPS Tailscale address on phones; plain `http://studio:5173` cannot access browser geolocation. The station pulse indicates recent receipt of data, not shaking intensity. Reduced-motion preferences are respected.


### Persistent circles and private maps

People supports multiple lasting circles on one device. Create a circle with a name and your name; use **Invite** to copy or share a seven-day link. Links open a preview/confirmation screen, never silently enroll a person. The invitation secret is in the URL fragment (not server request URLs), then removed from the address bar. New links coexist; revoke links in **Manage**. Members can confirm anyone in their circle, and only owners can rename the circle or change its suggested meeting point.

Each check-in appends to history. The board shows each person's latest status and arrival/departure with timestamps, not online status or a claim that they are currently safe. Circle settings never reset reports. Offline drafts and caches are scoped to the circle; pending drafts are explicitly sent. History is paginated separately from the latest board.

**Circle map**, toggled on the main Observe map or opened from People, shows named gathering spots and the latest shared check-in position per person, for up to 24 hours. The location checkbox starts off on every self check-in; browser permission alone does not share anything with a circle. You cannot attach your device's location to a proxy check-in. Shared snapshots include accuracy and capture time. **Manage → Remove my shared locations** clears your coordinates from that circle's server history; it cannot retract copies already seen or saved by another member. Locations are readable by circle members and the service operator, not end-to-end encrypted. Gathering spots are named by a member after tapping the map; creators and circle owners can remove them.

Migrations 0004–0005 preserve existing data, map old occasion text into historical context, link existing memberships to people, and introduce expiring/revocable invitations and optional coordinates. Device access is bearer-token based. Owners can remove a member under Manage; this revokes their access and all outstanding invitation links, while preserving attributed history. Clearing browser data loses device access. Members can rejoin with a new invitation as a new membership; owner recovery and linking new devices remain follow-up work.

### Sound while the page is open

Open the bell and enable sound to hear a preview and arm a gentle chime for new reports. Pick an agency and minimum magnitude independently of push preferences. It polls Panama reports every 30 seconds, ignores the first response and known IDs/revisions, and only sounds for events from the last 15 minutes. Initial server imports and catch-up after more than five minutes without a successful collection establish a silent baseline; they do not produce new-report markers or alerts. It works while the page is running, including background tabs when the browser permits activity; reload requires a tap to re-arm audio. Background suspension and device mute settings can suppress it. Push subscriptions remain the option for notifications when the page is closed. Desktop notification delivery still needs an end-to-end test on the intended browser/OS.

Sound styles: **Magnitude chime** (default style) uses C4, D4, E4, F4, G4, A4, B4, C5 for half-magnitude bands starting at M3 through M6.5. Values below M3 use C4; M6.5 and above use C5. The second tone stays a perfect fourth above the first, with unchanged timing and gain. **Simple** retains the original 660/880 Hz chime. A batch plays once at its strongest qualifying magnitude. Each band has a preview that does not arm alerts; rapid previews replace the previous chime. The chosen style persists on this device; sound itself remains opt-in.
