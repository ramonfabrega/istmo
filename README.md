# Istmo

[**Open Istmo →**](https://istmo.ramonfabrega.com)

A Panama-first earthquake observatory: live agency reports on an interactive globe, private circles for family check-ins, and a path to real station readings.

- **Observe:** UP and USGS reports with magnitude, depth, origin time, revisions and source freshness. Collected every minute; the app refreshes every 30 seconds.
- **Stay informed:** optional sound while the app is open and device notifications while it is closed.
- **Your people:** persistent circles, attributed check-ins, optional location snapshots and gathering places on the main map.

Reports remain attributed to their agencies. Istmo does not predict earthquakes or recommend whether a building is safe. No physical seismograph is connected yet; recorded-waveform replay is available only in development.

## Development

Requires **Bun 1.3.10** and **Node 24**. Bun manages dependencies; development tools and tests run on Node.

```sh
bun install --frozen-lockfile
bun run setup
bun run dev:all
```

Open [localhost:5173](http://localhost:5173). Cloudflare services run locally, with separate development data and gitignored credentials. See [local development](docs/local-development.md) for phone access, replay and resets.

## Checks and deployment

```sh
bun run test
bun run build:production
bun run test:integration # with the local app running
bun run bench:miniseed
```

Production runs on Cloudflare Workers, D1, R2 and Durable Objects. Git pushes to `main` deploy through Cloudflare Builds; deployment applies pending D1 migrations before publishing the Worker. See the [deployment runbook](docs/deployment.md) for build settings, secrets and verification.

## Documentation

- [Using Istmo](docs/using-istmo.md) — circles, location sharing and notifications
- [Architecture](docs/architecture.md) — source reconciliation, transport and data boundaries
- [Station protocol](docs/stations.md) — ingestion, replay and miniSEED scope
- [Local development](docs/local-development.md)
- [Deployment](docs/deployment.md)

Next: verify background push on real devices, add owner recovery/new-device linking, and connect calibrated hardware with batched archive storage.
