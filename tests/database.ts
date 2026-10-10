import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type { Env } from "../worker/env";
// Execute the collector's real SQL against SQLite and every actual migration.
// Only the Cloudflare binding transport is adapted; catalog logic is unchanged.
export function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  const prepare = (sql: string) => {
    let values: any[] = [];
    return {
      bind(...args: any[]) {
        values = args;
        return this;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      async run() {
        sqlite.prepare(sql).run(...values);
        return { success: true };
      },
    };
  };
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const s of statements) result.push(await s.run());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return {
    sqlite,
    env: { DB: db, ARCHIVE: { put: async () => {} } } as unknown as Env,
  };
}
