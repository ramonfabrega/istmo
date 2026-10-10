import assert from "node:assert/strict";
import { config } from "./config";
import { encodeInt32 } from "../shared/miniseed";
const cfg = config();
async function call(
  path: string,
  body?: unknown,
  token?: string,
  method = body ? "POST" : "GET",
) {
  const response = await fetch(cfg.url + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: (await response.json()) as any };
}
const health = await call("/api/health");
assert.equal(
  health.data.environment,
  "local",
  "Integration tests must run only against local development",
);
const a = await call("/api/family/create", {
  name: "Integration test circle",
  reporter: "Test reporter",
});
assert.equal(a.status, 201);
assert.equal(
  (await call("/api/family/invitation", { invite: a.data.invite })).data.name,
  "Integration test circle",
);
const b = await call("/api/family/join", {
  name: "Test uncle",
  invite: a.data.invite,
});
assert.equal(b.status, 200);
const board = await call("/api/family", undefined, a.data.token);
const joined = await call("/api/family", undefined, b.data.token);
assert.equal(
  board.data.people.length,
  2,
  "Every joining member has a linked person",
);
assert.ok(joined.data.member.person_id);
assert.equal(
  (
    await call(
      "/api/family/join",
      { name: "Ignored", invite: a.data.invite },
      b.data.token,
    )
  ).data.token,
  b.data.token,
);
const person = await call(
  "/api/family/people",
  { name: "Test grandparent" },
  a.data.token,
);
const checkin = {
  id: crypto.randomUUID(),
  personId: person.data.id,
  kind: "status",
  value: "okay",
  note: "Spoke by phone",
  contactedAt: Date.now(),
  meetingPoint: "Test courtyard",
};
assert.equal(
  (await call("/api/family/checkins", checkin, b.data.token)).status,
  201,
);
assert.equal(
  (await call("/api/family/checkins", checkin, b.data.token)).status,
  201,
);
assert.equal(
  (
    await call(
      "/api/family/checkins",
      { ...checkin, value: "help" },
      b.data.token,
    )
  ).status,
  409,
);
assert.equal(
  (
    await call(
      "/api/family/checkins",
      {
        ...checkin,
        id: crypto.randomUUID(),
        kind: "presence",
        value: "arrived",
      },
      a.data.token,
    )
  ).status,
  201,
);
const result = await call("/api/family", undefined, a.data.token);
assert.equal(result.data.checkins.length, 2);
assert.equal(
  result.data.checkins.find((c: any) => c.kind === "status").reporter_name,
  "Test uncle",
);
const other = await call("/api/family/create", {
  name: "Other test circle",
  reporter: "Other member",
});
assert.equal(
  (
    await call(
      "/api/family/checkins",
      { ...checkin, id: crypto.randomUUID() },
      other.data.token,
    )
  ).status,
  404,
);
assert.equal((await call("/api/family")).status, 401);
assert.equal(
  (
    await call(
      "/api/family/checkins",
      {
        ...checkin,
        id: crypto.randomUUID(),
        contactedAt: Date.now() + 86400000,
      },
      a.data.token,
    )
  ).status,
  400,
);
assert.equal(
  (
    await call(
      "/api/family/settings",
      { name: "Renamed", meetingPoint: "New courtyard" },
      b.data.token,
      "PATCH",
    )
  ).status,
  403,
);
assert.equal(
  (
    await call(
      "/api/family/settings",
      { name: "Integration test circle", meetingPoint: "New courtyard" },
      a.data.token,
      "PATCH",
    )
  ).status,
  200,
);
assert.equal(
  (await call("/api/family", undefined, a.data.token)).data.checkins.length,
  2,
  "Changing circle settings never resets check-ins",
);
assert.equal(
  (
    await call(
      "/api/family/checkins",
      { ...checkin, id: crypto.randomUUID(), contactedAt: Date.now() },
      b.data.token,
    )
  ).status,
  201,
);
const history = await call("/api/family/history", undefined, a.data.token);
assert.equal(
  history.data.items.length,
  3,
  "Repeated check-ins append to history",
);
assert.equal(history.data.items[0].meeting_point, "Test courtyard");
const location = {
  latitude: 8.98,
  longitude: -79.52,
  accuracy: 15,
  timestamp: Date.now(),
};
assert.equal(
  (
    await call(
      "/api/family/checkins",
      { ...checkin, id: crypto.randomUUID(), location },
      b.data.token,
    )
  ).status,
  403,
  "Cannot attach reporter's phone location to someone else",
);
const self = {
  ...checkin,
  id: crypto.randomUUID(),
  personId: board.data.member.person_id,
  contactedAt: Date.now(),
  location,
};
assert.equal(
  (
    await call(
      "/api/family/checkins",
      { ...self, location: { ...location, latitude: 91 } },
      a.data.token,
    )
  ).status,
  400,
);
assert.equal(
  (await call("/api/family/checkins", self, a.data.token)).status,
  201,
);
assert.equal(
  (await call("/api/family/checkins", self, a.data.token)).status,
  201,
);
assert.equal(
  (
    await call(
      "/api/family/checkins",
      { ...self, location: { ...location, longitude: -80 } },
      a.data.token,
    )
  ).status,
  409,
);
const geoBoard = await call("/api/family", undefined, a.data.token);
assert.equal(
  geoBoard.data.checkins.find((c: any) => c.id === self.id).latitude,
  8.98,
);
const spot = await call(
  "/api/family/places",
  { name: "Test courtyard", latitude: 8.97, longitude: -79.51 },
  a.data.token,
);
assert.equal(spot.status, 201);
assert.equal(
  (await call("/api/family", undefined, other.data.token)).data.places.length,
  0,
);
await call(
  `/api/family/places/${spot.data.id}`,
  undefined,
  other.data.token,
  "DELETE",
);
assert.equal(
  (await call("/api/family", undefined, a.data.token)).data.places.length,
  1,
  "Other circles cannot delete a spot",
);
await call("/api/family/my-locations", undefined, a.data.token, "DELETE");
assert.equal(
  (await call("/api/family/history", undefined, a.data.token)).data.items.find(
    (c: any) => c.id === self.id,
  ).latitude,
  null,
  "Location removal also clears history",
);
const newInvite = await call("/api/family/invite", {}, a.data.token);
assert.equal(
  (await call("/api/family/invitation", { invite: a.data.invite })).status,
  200,
  "New invitations don't invalidate others",
);
await call(
  `/api/family/invites/${newInvite.data.id}`,
  undefined,
  a.data.token,
  "DELETE",
);
assert.equal(
  (await call("/api/family/invitation", { invite: newInvite.data.invite }))
    .status,
  404,
);
assert.equal(
  (
    await call("/api/family/join", {
      name: "No entry",
      invite: newInvite.data.invite,
    })
  ).status,
  404,
);
assert.equal(
  (await call("/api/family/members", undefined, b.data.token)).status,
  403,
);
assert.equal(
  (
    await call(
      `/api/family/members/${joined.data.member.id}`,
      undefined,
      other.data.token,
      "DELETE",
    )
  ).status,
  404,
);
assert.equal(
  (
    await call(
      `/api/family/members/${board.data.member.id}`,
      undefined,
      a.data.token,
      "DELETE",
    )
  ).status,
  404,
);
assert.equal(
  (
    await call(
      `/api/family/members/${joined.data.member.id}`,
      undefined,
      a.data.token,
      "DELETE",
    )
  ).status,
  200,
);
assert.equal((await call("/api/family", undefined, b.data.token)).status, 401);
assert.equal(
  (await call("/api/family/invitation", { invite: a.data.invite })).status,
  404,
);
assert.equal(
  (await call("/api/family/history", undefined, a.data.token)).data.items
    .length,
  4,
  "Revocation preserves attribution and history",
);
console.log(
  "PASS persistent circles, linked membership, invitations/revocation, timeline, isolation, self-only location consent, gathering spots and location removal",
);
assert.equal((await call("/api/admin/stations", { id: "test" })).status, 401);
assert.equal(
  (
    await call(
      "/api/admin/stations",
      { id: "test", latitude: 91, longitude: 0, mode: "live", name: "Invalid" },
      cfg.ADMIN_TOKEN,
    )
  ).status,
  400,
);
console.log("PASS circle authorization and ingestion validation");
const session = "integration-" + crypto.randomUUID();
const seq = 0;
const start = Date.now();
const path = `/api/stations/replay-panama/records?session=${session}&sequence=${seq}&start=${start}`;
const record = encodeInt32(
  Int32Array.from([1, -1, 42]),
  Date.parse("2010-02-06T04:50:15Z"),
  200,
);
let response = await fetch(cfg.url + path, { method: "POST", body: record });
assert.equal(response.status, 401);
const socket = new WebSocket(
  cfg.url.replace(/^http/, "ws") + "/api/stations/replay-panama/stream",
);
socket.binaryType = "arraybuffer";
await new Promise<void>((resolve, reject) => {
  socket.onopen = () => resolve();
  socket.onerror = () => reject(new Error("WebSocket failed"));
  setTimeout(() => reject(new Error("WebSocket timeout")), 5000).unref();
});
const streamed = new Promise<void>((resolve, reject) => {
  let matched = false;
  socket.onmessage = (e) => {
    if (typeof e.data === "string") {
      const m = JSON.parse(e.data);
      matched = m.session === session;
    } else if (matched) {
      assert.equal(new Uint8Array(e.data)[64], 0);
      resolve();
    }
  };
  setTimeout(() => reject(new Error("Record not broadcast")), 5000).unref();
});
response = await fetch(cfg.url + path, {
  method: "POST",
  headers: { Authorization: `Bearer ${cfg.INGEST_TOKEN}` },
  body: record,
});
assert.equal(response.status, 200);
await streamed;
socket.close();
response = await fetch(cfg.url + path, {
  method: "POST",
  headers: { Authorization: `Bearer ${cfg.INGEST_TOKEN}` },
  body: record,
});
assert.equal(((await response.json()) as any).duplicate, true);
const conflict = record.slice(0);
new Uint8Array(conflict)[70] ^= 1;
assert.equal(
  (
    await fetch(cfg.url + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.INGEST_TOKEN}` },
      body: conflict,
    })
  ).status,
  409,
);
const downloaded = await fetch(
  cfg.url + `/api/records/${encodeURIComponent(`replay-panama:${session}:0`)}`,
);
assert.deepEqual(
  new Uint8Array(await downloaded.arrayBuffer()),
  new Uint8Array(record),
);
console.log(
  "PASS authenticated miniSEED ingest, binary WebSocket delivery, duplicate handling, byte-exact R2 round trip",
);
// Remove only this script's disposable family test data via an authenticated local-only endpoint.
for (const t of [a.data.token, other.data.token])
  await call("/api/family/test-cleanup", {}, t);
console.log("Integration checks complete.");
