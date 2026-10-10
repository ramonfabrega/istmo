import { expect, it, vi } from "vitest";
import type { Env } from "../worker/env";
const mocks = vi.hoisted(() => ({ collect: vi.fn(), drainPush: vi.fn() }));
vi.mock("../worker/collect", () => ({ collect: mocks.collect }));
vi.mock("../worker/push", () => ({ drainPush: mocks.drainPush }));
import { collectAndDeliver } from "../worker/dispatch";

it("dispatches UP reports while USGS is still fetching", async () => {
  let release!: () => void;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.collect.mockImplementation((_env, source) =>
    source === "usgs" ? slow : Promise.resolve(),
  );
  mocks.drainPush.mockResolvedValue(undefined);
  const task = collectAndDeliver({} as Env);
  try {
    // One retry drain immediately, another when UP completes, before USGS.
    await expect
      .poll(() => mocks.drainPush.mock.calls.length, { timeout: 200 })
      .toBe(2);
  } finally {
    release();
    await task;
  }
});
