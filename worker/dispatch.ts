import type { Env } from "./env";
import { collect } from "./collect";
import { drainPush } from "./push";

export async function collectAndDeliver(env: Env) {
  const results = await Promise.allSettled([
    drainPush(env), // Retry due jobs even while an upstream source is slow.
    ...(["up", "usgs"] as const).map(async (source) => {
      await collect(env, source);
      await drainPush(env);
    }),
  ]);
  if (results.some((result) => result.status === "rejected"))
    throw new Error(
      "Collection or push dispatch failed; queued jobs will retry.",
    );
}
