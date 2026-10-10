# Local development

Run the setup commands in the README. `dev:all` starts Vite, the agency collector and recorded-waveform replay. All three stop together. You can also run `bun run dev`, `bun run collect --watch`, and `bun run replay` separately.

State persists in `.wrangler/state`; credentials are generated in `.dev.vars`. Production uses separate resources and secrets. Never serve the server build or upload these local files.

## Phone access

Vite listens on port 5173 on all interfaces. Use your computer's LAN or Tailscale hostname to browse from a phone. Geolocation, installation and push require HTTPS.

For an existing Tailscale setup, `tailscale serve --bg --https=8443 http://127.0.0.1:5173` provides a private HTTPS URL. Add your hostname to Vite's `allowedHosts` if needed. Remove that route with `tailscale serve --https=8443 off`. This is optional local tooling; the public app does not depend on Tailscale or a running development computer.

## Replay

Open `/?demo=1` to see the recorded station. The fixture contains German ground motion from 2010 at a deliberately labeled demo Panama location. It is not a live Panama reading. `GAP_EVERY=30 bun run replay` inserts transport gaps for testing. Original timestamps remain in the archived records. See [fixture provenance](../fixtures/README.md).

## Migrations and resets

`bun run db:migrate` applies local migrations without resetting data. Setup seeds the replay station with `INSERT OR IGNORE`.

To reset: stop development processes, move `.wrangler/state` to a backup directory, then run `bun run setup`. Keep `.dev.vars` to retain local credentials. Old circle sessions will not match the fresh database; remove those circles from the device and create or join again. Do not use remote flags or production bindings for this workflow.

## Code conventions

Use one variable declaration per statement. Keep UI components focused on rendering and interaction; hooks own browser/API lifecycle details. Share substantial behavior behind small interfaces rather than splitting files solely by line count. Preserve agency data and keep transport framing separate from waveform decoding.

Run `bun run test` for Vitest; `bun test` invokes a different runner. Integration checks create and clean up only their own disposable local circles and exercise the replay station. Benchmarks are local measurements, not production throughput guarantees.
