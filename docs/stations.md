# Connecting a station

The included simulator uses recorded samples, not synthesized earthquake-looking noise. Run `npm run replay`; it reads `fixtures/replay.mseed`, loops it with a new session UUID at process start, and uploads one second of samples per second. Its Panama pin is a demo location. The original German waveform and provenance are in `fixtures/`.

## Provision

`POST /api/admin/stations`, with `Authorization: Bearer <ADMIN_TOKEN>` and JSON:

```json
{
  "id": "office-01",
  "name": "Office instrument",
  "latitude": 8.98,
  "longitude": -79.52,
  "mode": "live",
  "description": "Instrument model, installation and calibration notes"
}
```

Coordinates above are examples, not a configured private location. The response returns `{ id, token }`; save the token on the bridge. Only its hash is stored in D1. Existing IDs return 409; metadata edits/key rotation are not exposed yet. The seeded `replay-panama` station alone uses `INGEST_TOKEN` from `.dev.vars`.

## Submit

```
POST /api/stations/<id>/records?session=<uuid>&sequence=<integer>&start=<epoch-ms>
Authorization: Bearer <station-token>
Content-Type: application/vnd.fdsn.mseed

<exactly one complete miniSEED 2 record>
```

- Start a new unique session whenever sequence numbering restarts. Sequences must be nonnegative safe integers and advance across all submitted channels.
- `start` is the display timestamp. In live mode it must match the miniSEED header within 1 ms and be within one day of server time. In replay mode it is current playback time; the original timestamp remains in the header/archive.
- Supported record framing requires blockette 1000 and valid sample-rate/header metadata; browser decoding depends on seisplotjs' supported miniSEED 2 encodings. Maximum record size is 64 KiB.
- Retry the exact same bytes and parameters after an uncertain response. Success is `{ accepted: true, archived: true, live: boolean }`; duplicates return `duplicate: true`. A reused sequence with different content returns 409. Do not change its timestamp on retry.
- Records older than the live frontier are archived without broadcast. Historical backfill older than one day needs a separate future API.

## Receive / inspect

`GET /api/stations/<id>/stream` upgrades to a WebSocket. Text messages include hello/pong and a metadata object immediately before each binary record:

```json
{
  "type": "record",
  "station": "office-01",
  "session": "…",
  "sequence": 42,
  "start": 1791600000000,
  "originalStart": 1791600000000,
  "sampleRate": 200,
  "sampleCount": 200,
  "channel": "BW.BGLD..EHZ",
  "receivedAt": 1791600000100,
  "mode": "live",
  "gap": false
}
```

Example identifiers/times above illustrate the contract only. `gap` is a sequence hint, not a detector. Clients must account for actual channel timestamps and elapsed time. Send text `ping` for a pong. `GET /api/stations/<id>/archive` returns the latest 100 records; `GET /api/records/<encoded-record-id>` downloads original miniSEED bytes.

## Hardware boundary

No hardware-specific driver or SeedLink bridge is included yet. A small always-on host beside an instrument should own acquisition, time synchronization, a durable disk spool, and HTTP retries. Existing seismology software can read miniSEED/SeedLink and serve as that adapter. Keep raw samples; attach instrument response/orientation/gain before offering physical units. A phone sensor experiment would be a separately labeled uncalibrated source and needs a native acquisition/background-power design. It is not currently part of this PWA.

Before selecting hardware, establish the installation location/noise floor, useful frequency range, network/power availability, and whether the aim is a local motion display or participation in a wider calibrated network. The ingest contract does not depend on that hardware decision.
