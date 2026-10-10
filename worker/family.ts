import { Hono } from "hono";
import type { Env } from "./env";
import { digest } from "./crypto";
type Member = {
  id: string;
  group_id: string;
  name: string;
  person_id: string;
  role: string;
};
const app = new Hono<{ Bindings: Env; Variables: { member: Member } }>();
const token = () => crypto.randomUUID() + crypto.randomUUID();
const clean = (x: unknown, max = 100) =>
  typeof x === "string" ? x.trim().slice(0, max) : "";
const week = 7 * 86400000;
async function invitation(db: D1Database, value: unknown) {
  if (typeof value !== "string" || value.length > 200) return null;
  return db
    .prepare(
      "SELECT i.id,i.group_id,g.name FROM circle_invites i JOIN family_groups g ON g.id=i.group_id WHERE i.token_hash=? AND i.revoked_at IS NULL AND i.expires_at>?",
    )
    .bind(await digest(value), Date.now())
    .first<{ id: string; group_id: string; name: string }>();
}
app.post("/create", async (c) => {
  const b = await c.req.json();
  const name = clean(b.name);
  const reporter = clean(b.reporter);
  if (!name || !reporter)
    return c.json({ error: "Circle name and your name are required" }, 400);
  const id = crypto.randomUUID();
  const member = crypto.randomUUID();
  const person = crypto.randomUUID();
  const access = token();
  const invite = token();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO family_groups(id,name,invite_hash,meeting_point,created_at) VALUES(?,?,?,?,?)",
    ).bind(id, name, await digest(invite), "", now),
    c.env.DB.prepare("INSERT INTO people(id,group_id,name) VALUES(?,?,?)").bind(
      person,
      id,
      reporter,
    ),
    c.env.DB.prepare(
      "INSERT INTO members(id,group_id,name,token_hash,created_at,person_id,role) VALUES(?,?,?,?,?,?,?)",
    ).bind(member, id, reporter, await digest(access), now, person, "owner"),
    c.env.DB.prepare(
      "INSERT INTO circle_invites(id,group_id,token_hash,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      id,
      await digest(invite),
      member,
      now,
      now + week,
    ),
  ]);
  return c.json({ token: access, invite, groupId: id, name }, 201);
});
// POST keeps invitation credentials out of request URLs and access logs.
app.post("/invitation", async (c) => {
  const b = await c.req.json();
  const invite = await invitation(c.env.DB, b.invite);
  if (!invite)
    return c.json(
      { error: "This invitation expired or was revoked. Ask for a new link." },
      404,
    );
  return c.json({ id: invite.group_id, name: invite.name });
});
app.post("/join", async (c) => {
  const b = await c.req.json();
  const name = clean(b.name);
  if (!name) return c.json({ error: "Your name is required" }, 400);
  const invite = await invitation(c.env.DB, b.invite);
  if (!invite)
    return c.json(
      { error: "This invitation expired or was revoked. Ask for a new link." },
      404,
    );
  // Reopening an invitation on an enrolled device must not add another member.
  const existingToken = c.req.header("Authorization")?.replace(/^Bearer /, "");
  if (existingToken) {
    const existing = await c.env.DB.prepare(
      "SELECT id FROM members WHERE token_hash=? AND group_id=? AND revoked_at IS NULL",
    )
      .bind(await digest(existingToken), invite.group_id)
      .first();
    if (existing)
      return c.json({
        token: existingToken,
        groupId: invite.group_id,
        name: invite.name,
      });
  }
  const access = token();
  const member = crypto.randomUUID();
  const person = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO people(id,group_id,name) VALUES(?,?,?)").bind(
      person,
      invite.group_id,
      name,
    ),
    c.env.DB.prepare(
      "INSERT INTO members(id,group_id,name,token_hash,created_at,person_id) VALUES(?,?,?,?,?,?)",
    ).bind(
      member,
      invite.group_id,
      name,
      await digest(access),
      Date.now(),
      person,
    ),
  ]);
  return c.json({ token: access, groupId: invite.group_id, name: invite.name });
});
app.use("*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer "))
    return c.json({ error: "Join a circle first" }, 401);
  const member = await c.env.DB.prepare(
    "SELECT id,group_id,name,person_id,role FROM members WHERE token_hash=? AND revoked_at IS NULL",
  )
    .bind(await digest(auth.slice(7)))
    .first<Member>();
  if (!member)
    return c.json(
      { error: "Session not found. Use an invitation to rejoin." },
      401,
    );
  c.set("member", member);
  await next();
});
const checkinSelect =
  "SELECT c.*,m.name as reporter_name FROM checkins c JOIN members m ON m.id=c.reporter_id";
app.get("/", async (c) => {
  const member = c.get("member");
  const [group, people, checkins, places] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id,name,meeting_point FROM family_groups WHERE id=?",
    )
      .bind(member.group_id)
      .first(),
    c.env.DB.prepare(
      "SELECT id,name FROM people WHERE group_id=? ORDER BY name",
    )
      .bind(member.group_id)
      .all(),
    // One latest update per person/kind; quiet people don't disappear after 1,000 other updates.
    c.env.DB.prepare(
      `${checkinSelect} WHERE c.group_id=? AND c.id=(SELECT n.id FROM checkins n WHERE n.group_id=c.group_id AND n.person_id=c.person_id AND n.kind=c.kind ORDER BY n.contacted_at DESC,n.created_at DESC,n.id DESC LIMIT 1) ORDER BY c.contacted_at DESC`,
    )
      .bind(member.group_id)
      .all(),
    c.env.DB.prepare(
      "SELECT id,name,latitude,longitude,created_by,created_at FROM gathering_places WHERE group_id=? ORDER BY created_at",
    )
      .bind(member.group_id)
      .all(),
  ]);
  return c.json({
    group,
    member: {
      id: member.id,
      name: member.name,
      person_id: member.person_id,
      role: member.role,
    },
    people: people.results,
    checkins: checkins.results,
    places: places.results,
  });
});
app.get("/history", async (c) => {
  const group = c.get("member").group_id;
  const before = Number(c.req.query("before") || Number.MAX_SAFE_INTEGER);
  const beforeId = c.req.query("beforeId") || "~";
  const person = clean(c.req.query("person"));
  if (!Number.isFinite(before))
    return c.json({ error: "Invalid history cursor" }, 400);
  const rows = await c.env.DB.prepare(
    `${checkinSelect} WHERE c.group_id=? AND (?='' OR c.person_id=?) AND (c.created_at<? OR (c.created_at=? AND c.id<?)) ORDER BY c.created_at DESC,c.id DESC LIMIT 51`,
  )
    .bind(group, person, person, before, before, beforeId)
    .all();
  const items = rows.results.slice(0, 50);
  const last = items.at(-1);
  return c.json({
    items,
    next:
      rows.results.length > 50 && last
        ? { before: last.created_at, beforeId: last.id }
        : null,
  });
});
app.post("/people", async (c) => {
  const b = await c.req.json();
  const name = clean(b.name);
  if (!name) return c.json({ error: "Name required" }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO people(id,group_id,name) VALUES(?,?,?)")
    .bind(id, c.get("member").group_id, name)
    .run();
  return c.json({ id, name }, 201);
});
app.post("/checkins", async (c) => {
  const b = await c.req.json();
  const member = c.get("member");
  if (
    !["status", "presence"].includes(b.kind) ||
    !(
      b.kind === "status"
        ? ["okay", "help", "unknown"]
        : ["arrived", "left", "unknown"]
    ).includes(b.value)
  )
    return c.json({ error: "Invalid status" }, 400);
  const person = await c.env.DB.prepare(
    "SELECT id FROM people WHERE id=? AND group_id=?",
  )
    .bind(clean(b.personId), member.group_id)
    .first();
  if (!person) return c.json({ error: "Person not in this circle" }, 404);
  const place = clean(b.meetingPoint, 200);
  const note = clean(b.note, 500);
  const context = clean(b.context);
  if (b.kind === "presence" && !place)
    return c.json({ error: "Add a place for an arrival or departure" }, 400);
  const contacted = Number(b.contactedAt);
  const now = Date.now();
  if (
    !Number.isFinite(contacted) ||
    contacted > now + 60000 ||
    contacted < now - 30 * 86400000
  )
    return c.json(
      { error: "Contact time must be within the last 30 days" },
      400,
    );
  const geo = b.location;
  if (geo !== undefined && geo !== null) {
    if (b.personId !== member.person_id)
      return c.json(
        { error: "You can only share your own device location" },
        403,
      );
    if (
      ![geo.latitude, geo.longitude, geo.accuracy, geo.timestamp].every(
        (x) => typeof x === "number" && Number.isFinite(x),
      ) ||
      Math.abs(geo.latitude) > 90 ||
      Math.abs(geo.longitude) > 180 ||
      geo.accuracy < 0 ||
      geo.accuracy > 100000 ||
      geo.timestamp > contacted + 60000 ||
      geo.timestamp < contacted - 300000
    )
      return c.json({ error: "Location must be a recent valid reading" }, 400);
  }
  const id = clean(b.id, 80) || crypto.randomUUID();
  if (!/^[a-zA-Z0-9-]{10,80}$/.test(id))
    return c.json({ error: "Invalid check-in ID" }, 400);
  const previous = await c.env.DB.prepare("SELECT * FROM checkins WHERE id=?")
    .bind(id)
    .first();
  if (
    previous &&
    (previous.reporter_id !== member.id ||
      previous.person_id !== b.personId ||
      previous.kind !== b.kind ||
      previous.value !== b.value ||
      previous.note !== note ||
      previous.contacted_at !== contacted ||
      previous.meeting_point !== place ||
      previous.context !== context ||
      previous.latitude !== (geo?.latitude ?? null) ||
      previous.longitude !== (geo?.longitude ?? null) ||
      previous.accuracy !== (geo?.accuracy ?? null) ||
      previous.located_at !== (geo?.timestamp ?? null))
  )
    return c.json({ error: "Check-in ID conflict" }, 409);
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO checkins(id,group_id,person_id,reporter_id,context,kind,value,note,contacted_at,created_at,meeting_point,latitude,longitude,accuracy,located_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      member.group_id,
      b.personId,
      member.id,
      context,
      b.kind,
      b.value,
      note,
      contacted,
      now,
      place,
      geo?.latitude ?? null,
      geo?.longitude ?? null,
      geo?.accuracy ?? null,
      geo?.timestamp ?? null,
    )
    .run();
  return c.json({ id }, 201);
});
app.post("/places", async (c) => {
  const b = await c.req.json();
  const m = c.get("member");
  const name = clean(b.name);
  if (
    !name ||
    typeof b.latitude !== "number" ||
    typeof b.longitude !== "number" ||
    !Number.isFinite(b.latitude) ||
    !Number.isFinite(b.longitude) ||
    Math.abs(b.latitude) > 90 ||
    Math.abs(b.longitude) > 180
  )
    return c.json({ error: "Name and valid map coordinates required" }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO gathering_places(id,group_id,name,latitude,longitude,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(id, m.group_id, name, b.latitude, b.longitude, m.id, Date.now())
    .run();
  return c.json({ id }, 201);
});
app.delete("/places/:id", async (c) => {
  const m = c.get("member");
  await c.env.DB.prepare(
    "DELETE FROM gathering_places WHERE id=? AND group_id=? AND (created_by=? OR ?='owner')",
  )
    .bind(c.req.param("id"), m.group_id, m.id, m.role)
    .run();
  return c.json({ ok: true });
});
app.delete("/my-locations", async (c) => {
  const m = c.get("member");
  await c.env.DB.prepare(
    "UPDATE checkins SET latitude=NULL,longitude=NULL,accuracy=NULL,located_at=NULL WHERE group_id=? AND reporter_id=?",
  )
    .bind(m.group_id, m.id)
    .run();
  return c.json({ ok: true });
});
app.patch("/settings", async (c) => {
  if (c.get("member").role !== "owner")
    return c.json(
      { error: "Only the circle owner can change its settings" },
      403,
    );
  const b = await c.req.json();
  const name = clean(b.name);
  if (!name) return c.json({ error: "Circle name required" }, 400);
  await c.env.DB.prepare(
    "UPDATE family_groups SET name=?,meeting_point=? WHERE id=?",
  )
    .bind(name, clean(b.meetingPoint, 200), c.get("member").group_id)
    .run();
  return c.json({ ok: true });
});
app.post("/invite", async (c) => {
  const invite = token();
  const member = c.get("member");
  const now = Date.now();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO circle_invites(id,group_id,token_hash,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(id, member.group_id, await digest(invite), member.id, now, now + week)
    .run();
  return c.json({ invite, id, expiresAt: now + week });
});
app.get("/invites", async (c) => {
  const m = c.get("member");
  const rows = await c.env.DB.prepare(
    "SELECT id,created_at,expires_at,revoked_at FROM circle_invites WHERE group_id=? AND (created_by=? OR ?='owner') ORDER BY created_at DESC LIMIT 100",
  )
    .bind(m.group_id, m.id, m.role)
    .all();
  return c.json(rows.results);
});
app.delete("/invites/:id", async (c) => {
  const m = c.get("member");
  await c.env.DB.prepare(
    "UPDATE circle_invites SET revoked_at=? WHERE id=? AND group_id=? AND (created_by=? OR ?='owner')",
  )
    .bind(Date.now(), c.req.param("id"), m.group_id, m.id, m.role)
    .run();
  return c.json({ ok: true });
});
app.get("/members", async (c) => {
  const m = c.get("member");
  if (m.role !== "owner")
    return c.json({ error: "Only the owner can manage access" }, 403);
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,name,role,created_at,revoked_at FROM members WHERE group_id=? ORDER BY created_at",
      )
        .bind(m.group_id)
        .all()
    ).results,
  );
});
app.delete("/members/:id", async (c) => {
  const m = c.get("member");
  if (m.role !== "owner")
    return c.json({ error: "Only the owner can manage access" }, 403);
  const target = await c.env.DB.prepare(
    "SELECT id FROM members WHERE id=? AND group_id=? AND role!='owner'",
  )
    .bind(c.req.param("id"), m.group_id)
    .first();
  if (!target)
    return c.json({ error: "Member not found or cannot be removed" }, 404);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE members SET revoked_at=? WHERE id=? AND group_id=?",
    ).bind(now, target.id, m.group_id),
    // Close old entry points as well: a removed member may have saved any link.
    c.env.DB.prepare(
      "UPDATE circle_invites SET revoked_at=? WHERE group_id=? AND revoked_at IS NULL",
    ).bind(now, m.group_id),
  ]);
  return c.json({ ok: true });
});
app.post("/test-cleanup", async (c) => {
  if (c.env.APP_ENV !== "local") return c.notFound();
  const id = c.get("member").group_id;
  const group = await c.env.DB.prepare(
    "SELECT name FROM family_groups WHERE id=?",
  )
    .bind(id)
    .first<{ name: string }>();
  if (
    !["Integration test circle", "Other test circle"].includes(
      group?.name || "",
    )
  )
    return c.json(
      { error: "Only disposable integration fixtures can be removed" },
      403,
    );
  await c.env.DB.batch(
    [
      "gathering_places",
      "circle_invites",
      "checkins",
      "members",
      "people",
      "family_groups",
    ].map((table) =>
      c.env.DB.prepare(
        `DELETE FROM ${table} WHERE ${table === "family_groups" ? "id" : "group_id"}=?`,
      ).bind(id),
    ),
  );
  return c.json({ ok: true });
});
export default app;
