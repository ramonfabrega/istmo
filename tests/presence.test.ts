import { expect, it } from "vitest";
import { PresenceState } from "../worker/presence-state";
it("deduplicates heartbeats, expires inactive sessions, and preserves refreshed sessions", () => {
  const state = new PresenceState(10, 0);
  state.touch("a", 0);
  state.touch("b", 1000);
  state.touch("a", 50000);
  expect(state.count(89999).active).toBe(2);
  expect(state.count(91000).active).toBe(1);
  expect(state.count(140000).active).toBe(0);
});
it("bounds memory without evicting existing viewers and recovers capacity after expiry", () => {
  const state = new PresenceState(2, 0);
  expect(state.touch("a", 0)).toBe(true);
  expect(state.touch("b", 0)).toBe(true);
  expect(state.touch("c", 1)).toBe(false);
  expect(state.touch("a", 1000)).toBe(true);
  expect(state.touch("c", 90000)).toBe(true);
  expect(state.count(90000).active).toBe(2);
});
