import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { database } from "./database";
import snapshot from "./fixtures/up-corrections/split-records.json";
const repair = readFileSync(
  "scripts/repairs/2026-10-10-up-corrections.sql",
  "utf8",
);
function fixture() {
  const { sqlite } = database();
  for (const [table, rows] of Object.entries({
    reports: snapshot.reports,
    report_revisions: snapshot.revisions,
  })) {
    for (const row of rows) {
      const keys = Object.keys(row);
      sqlite
        .prepare(
          `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        )
        .run(...Object.values(row));
    }
  }
  const apply = () => {
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(repair);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  return { sqlite, apply };
}
it("repairs the three audited splits, preserves every revision and leaves the uncertain pair untouched", () => {
  const { sqlite, apply } = fixture();
  try {
    apply();
    expect(sqlite.prepare("SELECT count(*) AS n FROM reports").get()?.n).toBe(
      snapshot.reports.length - 3,
    );
    const history = sqlite
      .prepare(
        "SELECT observed_at,payload FROM report_revisions ORDER BY observed_at,payload",
      )
      .all();
    expect(history).toEqual(
      snapshot.revisions
        .map(({ observed_at, payload }) => ({ observed_at, payload }))
        .sort(
          (a, b) =>
            a.observed_at - b.observed_at || a.payload.localeCompare(b.payload),
        ),
    );
    for (const [oldId, keepId] of [
      ["up:1791613634000", "up:1791613631000"],
      ["up:1791613792000", "up:1791613801000"],
      ["up:1791614870000", "up:1791614869000"],
    ]) {
      const old = snapshot.reports.find((r) => r.id === oldId)!;
      const keep = snapshot.reports.find((r) => r.id === keepId)!;
      expect(
        sqlite.prepare("SELECT * FROM reports WHERE id=?").get(keepId),
      ).toEqual({
        ...keep,
        first_seen: old.first_seen,
        new_report_at: old.new_report_at,
        revision: old.revision + keep.revision,
      });
      expect(
        sqlite
          .prepare(
            "SELECT revision FROM report_revisions WHERE report_id=? ORDER BY revision",
          )
          .all(keepId)
          .map((r) => r.revision),
      ).toEqual(
        Array.from({ length: old.revision + keep.revision }, (_, i) => i + 1),
      );
    }
    for (const id of ["up:1791611787000", "up:1791611804000"])
      expect(
        sqlite.prepare("SELECT * FROM reports WHERE id=?").get(id),
      ).toEqual(snapshot.reports.find((r) => r.id === id));
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() => apply()).toThrow();
    expect(
      sqlite
        .prepare(
          "SELECT observed_at,payload FROM report_revisions ORDER BY observed_at,payload",
        )
        .all(),
    ).toEqual(history);
  } finally {
    sqlite.close();
  }
});
it.each(["active collection", "changed report", "missing history"])(
  "rolls back without changes on %s",
  (failure) => {
    const { sqlite, apply } = fixture();
    try {
      if (failure === "active collection")
        sqlite
          .prepare("INSERT INTO collection_leases VALUES('up','busy',?)")
          .run(Date.now() + 60000);
      if (failure === "changed report")
        sqlite.exec(
          "UPDATE reports SET fingerprint='changed' WHERE id='up:1791614869000'",
        );
      if (failure === "missing history")
        sqlite.exec(
          "DELETE FROM report_revisions WHERE report_id='up:1791614870000'",
        );
      const before = sqlite.prepare("SELECT * FROM reports ORDER BY id").all();
      const history = sqlite
        .prepare("SELECT * FROM report_revisions ORDER BY report_id,revision")
        .all();
      expect(() => apply()).toThrow();
      expect(sqlite.prepare("SELECT * FROM reports ORDER BY id").all()).toEqual(
        before,
      );
      expect(
        sqlite
          .prepare("SELECT * FROM report_revisions ORDER BY report_id,revision")
          .all(),
      ).toEqual(history);
      expect(
        sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE name LIKE '_up_repair_%'",
          )
          .all(),
      ).toEqual([]);
    } finally {
      sqlite.close();
    }
  },
);
