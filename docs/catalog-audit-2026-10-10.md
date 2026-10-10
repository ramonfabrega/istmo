# UP correction identity audit — October 10, 2026

UP has no immutable event ID in the index we ingest. Its detail URL contains the
report fields themselves. Istmo therefore follows replacements across snapshots;
origin time alone cannot serve as a permanent identity.

## Incident

The M4.8 report with corrected origin 01:47:49 Panama time appeared to arrive about
11 minutes late. The archive shows a different sequence:

- 01:50:22: absent from UP's fetched index.
- 01:51:22: first received, origin 01:47:50, location southeast of Las Tablas.
- 01:58:22: replaced by origin 01:47:49, location northeast of Tonosí, about 32 km away.

The original receipt lag was about 3m32s. The correction exceeded our former 20 km
matching radius and became another report, resetting its receipt/new-report clock.
This was an identity error, not an 11-minute polling gap. The archive bounds when
we observed publication; it cannot establish the exact upstream publication time.

## Historical findings

The pre-repair export contains 132 UP rows, 137 revisions, and four withdrawals.
We inspected all four withdrawals and the revisions of their same-poll arrivals,
then compared the archived HTML immediately before/after each transition.
Three unique disappearance/replacement pairs fit the correction evidence:

| Withdrawn ID       | Retained active ID | Initial correction           | First receipt → replacement (Panama) |
| ------------------ | ------------------ | ---------------------------- | ------------------------------------ |
| `up:1791613634000` | `up:1791613631000` | −3 seconds, ~36 km, M5.1→5.2 | 01:29:29 → 01:30:29                  |
| `up:1791613792000` | `up:1791613801000` | +9 seconds, ~86 km, M5.8→5.5 | 01:36:25 → 01:42:22                  |
| `up:1791614870000` | `up:1791614869000` | −1 second, ~32 km, M4.8→4.8  | 01:51:22 → 01:58:22                  |

The first retained report subsequently received another correction to 01:27:09.
That existing revision is preserved too.

The fourth withdrawal (`up:1791611787000`, near David) coincided with an arrival
near Tonosí, but differed by 17 seconds, over 200 km, and M3.5→4.7. It remains
withdrawn and unmerged; the available evidence does not justify claiming identity.
This audit covers retained database history and those archived transitions, not
records predating our collection or observations no longer retained.

## Prevention

A correction candidate must be within 10 seconds, 100 km, and 0.6 magnitude units.
It must also be a unique match in **both directions**, with the old row disappearing
and the new row appearing. Coexisting rows stay distinct, and ambiguous matches
stay separate. This is conservative inference from UP snapshots, not a source
provided identity guarantee. The database lookback uses the same time margin.

Three archived regressions failed first with two records instead of one. They now
assert stable identity, original first receipt/new-report time, revision history,
and no duplicate push enqueue. Tests also cover ambiguity, coexistence, bounds,
the oldest-row lookup margin, and the uncertain David/Tonosí replacement.

## Repair and recovery

The one-time SQL is `scripts/repairs/2026-10-10-up-corrections.sql`. It retains the
active IDs, combines revision payloads in observation order, restores original
receipt/new-report timestamps, and removes only the three withdrawn split rows.
It changes no current earthquake measurements or push jobs and sends no alerts.
Previously delivered notifications cannot be recalled.

Before execution, the earthquake-only export was stored in private R2:
`istmo-production-archive/audits/2026-10-10-up-corrections/before.json`.
The raw source pages remain under `sources/up/<observation timestamp>.html`;
trimmed, otherwise unmodified HTML rows and affected database records are checked
in under `tests/fixtures/up-corrections/`.

The exact repair was first executed on an in-memory copy of the entire export:
132→129 rows, all 137 revision payloads/observation timestamps preserved, one
withdrawal left, and no foreign-key violations. Tests verify full rollback for
changed records, missing history, an active collection lease, and repeat execution.

Deploy the collector fix first. Execute the SQL as one atomic D1 import using
Wrangler, never separate statements. Guards require all three exact expected
pairs and reject an active UP collection lease. If the lease guard fails, wait
for collection to finish and retry the whole import. If any other guard fails,
re-export and investigate; do not weaken it. Reapplying a completed repair fails
safely. Cloudflare documents import rollback in its
[Wrangler D1 implementation](https://github.com/cloudflare/workers-sdk/tree/main/packages/wrangler/src/d1).

Afterward, compare every revision payload/timestamp against the export, verify
canonical first receipt/revision counts, check foreign keys and health, and fetch
the public report/revision API after its five-second cache expires. Additional
new quakes collected during this procedure should remain untouched.
