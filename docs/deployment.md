# Production

Public URL: https://istmo.ramonfabrega.com

- Worker: `istmo`, environment `production` in `wrangler.jsonc`.
- Account: `2deff21d2e459d1c5997c4fe57a208e2`.
- D1: `istmo-production`, `b3a52b8d-f0f5-4742-938d-7dca734ad446`.
- Private R2: `istmo-production-archive`; `sources/` objects expire after 30 days.
- Cron: every minute. UP and USGS failures are recorded independently in `sources`.
- API rate limits: 300 reads and 60 writes per IP per minute at each Cloudflare location. These are abuse controls, not exact account-wide quotas.
- Worker logs enabled at 10% sampling. No request bodies or credentials are intentionally logged.
- No production station is provisioned. A physical station needs an individual ingest token, calibration and archive batching before sustained use.

## Release

Run unit and local integration checks, then push to `main`. Cloudflare Builds compiles the production bundle, applies pending production migrations, and deploys the Worker only if migrations succeed. For an operator-triggered manual release, `bun run deploy` runs the same sequence locally. Wrangler records applied migrations; subsequent deploys skip them. Use additive, backward-compatible migrations: the old Worker remains live while the database changes, and a failed Worker deployment does not undo a completed migration. The build must use `CLOUDFLARE_ENV=production`; the generated `dist/istmo/wrangler.json` must have `APP_ENV=production` and the production D1 ID. Deploying a local build is not safe. `dist/client` is the only public asset directory.

Secrets are uploaded separately with `bunx wrangler secret bulk .dev.vars.production --env production`. The private file is gitignored and must be backed up securely. Neither it nor `dist/istmo/.dev.vars` belongs in a public upload. Existing push subscriptions require the same VAPID key pair.

## Verification

`GET /api/health` must say `production`. `GET /api/reports?hours=168` returns source status; both `last_success` timestamps should advance between minute polls without an admin collection request. `GET /api/stations` is empty until real hardware is enrolled. Anonymous circle access returns 401; foreign Origin headers return 403; raw admin imports and test-cleanup are disabled in production.

Check the map on a phone over HTTPS. On iPhone install via Safari → Add to Home Screen, then enable notifications from the bell and send a test. Push-service acceptance is not proof the device displayed it. Verify a closed-app test on the intended real phone.

## Data / access

Production starts empty and collects live agency data. Local tests remain local. UP timestamp corrections keep stable IDs only for conservative one-to-one matches; withdrawn index entries stay archived but leave the active map. A functional UP detail link does not independently validate a report.

Circle coordinates are opt-in per check-in, readable by circle members and the operator. Map pins disappear after 24 hours; underlying coordinates persist until cleared. Owners can revoke a member and all current invitation links. Device access is saved locally; clearing browser data loses it. Owner recovery and new-device identity linking are not implemented. Historical records are retained; operator removal requires a targeted, reviewed database operation.

For a regression, redeploy a known previous Worker version through Cloudflare's deployment controls; do not roll back D1 by deleting tables. Preserve backward compatibility in future schema migrations. Monitor collection freshness and Cloudflare usage in the dashboard; no external uptime paging has been configured.

## Cloudflare Git integration

Connect the public `ramonfabrega/istmo` repository to the existing **istmo** Worker, with production branch `main` and repository root `/`.

- Build command: `bun run build:production`
- Deploy command: `bun run deploy:production`
- Build environment variables: `BUN_VERSION=1.3.10`, `NODE_VERSION=24`.
- `bun.lock` selects Bun installation. Commit only this lockfile; use `bun install --frozen-lockfile` for reproducible installs.
- Use `bun run test`, not `bun test`: the suite uses Vitest on Node, including `node:sqlite`.

The Cloudflare build token needs permission to deploy this Worker and apply D1 migrations. Existing runtime secrets stay on the Worker; do not add `.dev.vars.production` to Git or upload those secrets as public build variables. No VAPID/private keys are needed to compile the app. Keep preview branches from deploying to production until a separate preview environment is configured.
