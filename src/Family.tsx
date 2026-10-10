import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  MapPin,
  Plus,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import type { Family as FamilyData, Checkin } from "../shared/types";
import { ago, api, dateTime, safeRead, safeWrite, uuid } from "./api";
import {
  inviteCode,
  invitationLink,
  savedCircles,
  type CircleSession,
} from "./circles";

type Pending = {
  id: string;
  personId: string;
  kind: string;
  value: string;
  note: string;
  contactedAt: number;
  meetingPoint: string;
  context?: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
  };
};
type InviteInfo = {
  id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
};
const incomingCode = () =>
  new URLSearchParams(location.hash.slice(1)).get("invite") || "";
const describe = (c?: Checkin) =>
  !c
    ? "No check-in yet"
    : {
        okay: "Reported okay",
        help: "Asked for help",
        unknown: "Not confirmed",
        arrived: "Arrived",
        left: "Left",
      }[c.value] || c.value;

export default function Family({
  onShowMap,
}: {
  onShowMap: (session: CircleSession) => void;
}) {
  const [sessions, setSessions] = useState(savedCircles);
  const [active, setActive] = useState(() =>
    safeRead("istmo-active-circle", ""),
  );
  const [setup, setSetup] = useState(
    () => !!incomingCode() || !savedCircles().length,
  );
  const [tab, setTab] = useState<"create" | "join">(() =>
    incomingCode() ? "join" : "create",
  );
  const [invitation, setInvitation] = useState(incomingCode);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [reporter, setReporter] = useState(
    () => savedCircles()[0]?.reporter || "",
  );
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previewRequest = useRef(0);
  const initialInvitation = useRef(incomingCode());
  const session = sessions.find((s) => s.id === active) || sessions[0];
  const persist = (next: CircleSession[]) => {
    setSessions(next);
    safeWrite("istmo-circles", next);
  };
  const select = (id: string) => {
    setActive(id);
    safeWrite("istmo-active-circle", id);
    setSetup(false);
    setError("");
  };
  const inspectInvite = async (value: string) => {
    const request = ++previewRequest.current;
    const code = inviteCode(value);
    setPreview(null);
    setError("");
    if (!code) {
      setError("Paste an invitation link or code from your circle.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ id: string; name: string }>(
        "/api/family/invitation",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invite: code }),
        },
      );
      if (request === previewRequest.current) {
        setInvitation(code);
        setPreview(result);
        initialInvitation.current = "";
      }
    } catch (e) {
      if (request === previewRequest.current) setError(String(e));
    } finally {
      if (request === previewRequest.current) setBusy(false);
    }
  };
  useEffect(() => {
    const receive = () => {
      const code = incomingCode() || initialInvitation.current;
      if (!code) return;
      setInvitation(code);
      setSetup(true);
      setTab("join");
      // Fragments never reach the server. Remove the secret from the address bar after reading it.
      window.history.replaceState(
        null,
        "",
        location.pathname + location.search,
      );
      void inspectInvite(code);
    };
    receive();
    window.addEventListener("hashchange", receive);
    return () => {
      window.removeEventListener("hashchange", receive);
      previewRequest.current++;
    };
  }, []);
  const enroll = async () => {
    setBusy(true);
    setError("");
    try {
      const existing = preview && sessions.find((s) => s.id === preview.id);
      if (tab === "join" && existing) {
        select(existing.id);
        return;
      }
      const result = await api<{
        token: string;
        groupId: string;
        name: string;
        invite?: string;
      }>(`/api/family/${tab}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          tab === "create"
            ? { name, reporter }
            : { name: reporter, invite: inviteCode(invitation) },
        ),
      });
      const next = {
        id: result.groupId,
        name: result.name,
        reporter,
        token: result.token,
      };
      persist([...sessions.filter((s) => s.id !== next.id), next]);
      select(next.id);
      setPreview(null);
      setInvitation("");
      setName("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const alreadyJoined = preview && sessions.some((s) => s.id === preview.id);
  return (
    <div className="family-page">
      <div className="family-title">
        <div>
          <span className="eyeline">Private circles</span>
          <h1>Your people.</h1>
          <p>
            A lasting group. Check in anytime, for yourself or someone you’ve
            reached.
          </p>
        </div>
        <Users size={32} />
      </div>
      {sessions.length > 0 && (
        <div className="circle-switcher">
          <select
            aria-label="Current circle"
            value={session?.id || ""}
            onChange={(e) => select(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setSetup(true);
              setPreview(null);
              setInvitation("");
              setError("");
            }}
          >
            <Plus size={15} />
            Add circle
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="family-content">
        {setup || !session ? (
          <section className="onboard">
            <div className="tabs">
              {(["create", "join"] as const).map((t) => (
                <button
                  key={t}
                  disabled={busy}
                  className={tab === t ? "active" : ""}
                  onClick={() => {
                    previewRequest.current++;
                    setTab(t);
                    setPreview(null);
                    setError("");
                  }}
                >
                  {t === "create" ? "Create a circle" : "Join a circle"}
                </button>
              ))}
              {session && (
                <button
                  aria-label="Cancel adding a circle"
                  onClick={() => {
                    previewRequest.current++;
                    setBusy(false);
                    setSetup(false);
                    setError("");
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <h2>
              {preview
                ? `Join ${preview.name}?`
                : tab === "create"
                  ? "Keep your people close."
                  : "Have an invitation?"}
            </h2>
            <p>
              {preview
                ? "Members can see each other’s check-ins. Join when you’re ready."
                : tab === "create"
                  ? "One circle for everyday updates, gathering plans, and checking on each other."
                  : "Open a shared link, or paste one below. You’ll confirm before joining."}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void (tab === "join" && !preview
                  ? inspectInvite(invitation)
                  : enroll());
              }}
            >
              {tab === "join" && !preview ? (
                <label className="full-field">
                  Invitation link or code
                  <input
                    required
                    value={invitation}
                    onChange={(e) => setInvitation(e.target.value)}
                    placeholder="Paste your invitation"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={2048}
                  />
                </label>
              ) : (
                !alreadyJoined && (
                  <label>
                    Your name
                    <input
                      required
                      value={reporter}
                      onChange={(e) => setReporter(e.target.value)}
                      placeholder="How your people know you"
                      maxLength={100}
                    />
                  </label>
                )
              )}
              {tab === "create" && (
                <label>
                  Circle name
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Family, friends, neighbors…"
                    maxLength={100}
                  />
                </label>
              )}
              <button className="primary" disabled={busy}>
                {busy
                  ? "Connecting…"
                  : tab === "create"
                    ? "Create circle"
                    : alreadyJoined
                      ? "Open this circle"
                      : preview
                        ? "Join circle"
                        : "Continue"}
              </button>
            </form>
            <small>
              Invitation links grant access to the circle. Share them privately.
            </small>
          </section>
        ) : (
          <CircleBoard
            key={session.token}
            session={session}
            onShowMap={() => onShowMap(session)}
            onRename={(newName) =>
              persist(
                sessions.map((s) =>
                  s.id === session.id ? { ...s, name: newName } : s,
                ),
              )
            }
            onForget={() => {
              const next = sessions.filter((s) => s.id !== session.id);
              persist(next);
              safeWrite(`istmo-circle:${session.id}`, null);
              safeWrite(`istmo-pending:${session.id}`, []);
              setActive(next[0]?.id || "");
              safeWrite("istmo-active-circle", next[0]?.id || "");
              setSetup(!next.length);
            }}
          />
        )}
      </div>
      <footer className="panel-footer">
        Last check-in, not live status. Each update keeps its time and reporter.
      </footer>
    </div>
  );
}

function CircleBoard({
  session,
  onShowMap,
  onRename,
  onForget,
}: {
  session: CircleSession;
  onShowMap: () => void;
  onRename: (s: string) => void;
  onForget: () => void;
}) {
  const cacheKey = `istmo-circle:${session.id}`;
  const queueKey = `istmo-pending:${session.id}`;
  const [data, setData] = useState<FamilyData | null>(() =>
    safeRead(cacheKey, null),
  );
  const [queue, setQueue] = useState<Pending[]>(() => safeRead(queueKey, []));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState("");
  const [place, setPlace] = useState("");
  const [includeLocation, setIncludeLocation] = useState(false);
  const [newPerson, setNewPerson] = useState("");
  const [edit, setEdit] = useState(false);
  const [forget, setForget] = useState(false);
  const [settings, setSettings] = useState({
    name: session.name,
    meetingPoint: "",
  });
  const [history, setHistory] = useState<Checkin[] | null>(null);
  const [cursor, setCursor] = useState<{
    before: number;
    beforeId: string;
  } | null>(null);
  const [members, setMembers] = useState<Array<{
    id: string;
    name: string;
    role: string;
    revoked_at: number | null;
  }> | null>(null);
  const [removeMember, setRemoveMember] = useState<string | null>(null);
  const [invites, setInvites] = useState<InviteInfo[] | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected("");
        setEdit(false);
        setForget(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const mounted = useRef(true);
  const request = <T,>(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) =>
    api<T>(`/api/family${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const refresh = async () => {
    try {
      const next = await request<FamilyData>("");
      if (!mounted.current) return;
      setData(next);
      safeWrite(cacheKey, next);
      setOffline(false);
    } catch (e) {
      if (mounted.current) {
        setOffline(true);
        setError(String(e));
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const online = () => void refresh();
    const off = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
    };
  }, []);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const saveQueue = (next: Pending[]) => {
    setQueue(next);
    safeWrite(queueKey, next);
  };
  const payload = (p: Pending) => ({
    id: p.id,
    personId: p.personId,
    kind: p.kind,
    value: p.value,
    note: p.note,
    contactedAt: p.contactedAt,
    meetingPoint: p.meetingPoint || "",
    context: p.context || "",
    ...(p.location ? { location: p.location } : {}),
  });
  const checkin = (kind: string, value: string) =>
    action(async () => {
      const item: Pending = {
        id: uuid(),
        personId: selected,
        kind,
        value,
        note,
        meetingPoint: place,
        contactedAt: Date.now(),
      };
      if (includeLocation) {
        if (selected !== data?.member.person_id)
          throw new Error("Only your own location can be shared.");
        const position = await new Promise<GeolocationPosition>(
          (resolve, reject) => {
            if (!window.isSecureContext || !navigator.geolocation)
              return reject(new Error("Location needs the secure HTTPS link."));
            navigator.geolocation.getCurrentPosition(
              resolve,
              () =>
                reject(
                  new Error(
                    "Location unavailable. Try again or turn off location sharing.",
                  ),
                ),
              { enableHighAccuracy: true, maximumAge: 30000, timeout: 12000 },
            );
          },
        );
        item.location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };
        item.contactedAt = Date.now();
      }
      if (offline || !navigator.onLine) saveQueue([...queue, item]);
      else {
        await request("/checkins", payload(item));
        await refresh();
      }
      setSelected("");
      setHistory(null);
    });
  const loadHistory = (more = false) =>
    action(async () => {
      const query =
        more && cursor
          ? `?before=${cursor.before}&beforeId=${encodeURIComponent(cursor.beforeId)}`
          : "";
      const result = await request<{ items: Checkin[]; next: typeof cursor }>(
        `/history${query}`,
      );
      setHistory(more ? [...(history || []), ...result.items] : result.items);
      setCursor(result.next);
    });
  const latest = (id: string, kind: string) =>
    data?.checkins
      .filter((c) => c.person_id === id && c.kind === kind)
      .sort(
        (a, b) =>
          b.contacted_at - a.contacted_at || b.created_at - a.created_at,
      )[0];
  const openCheckin = (id: string) => {
    setSelected(id);
    setIncludeLocation(false);
    setNote("");
    setPlace(data?.group.meeting_point || "");
    setError("");
  };
  if (!data)
    return (
      <div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <p>
          {offline ? "This circle is unavailable." : "Loading your circle…"}
        </p>
        <button onClick={() => void refresh()}>Retry</button>
        <button onClick={onForget}>Remove from this device</button>
      </div>
    );
  return (
    <div className="circle-board">
      <div className="circle-toolbar">
        <div>
          <h2>{data.group.name}</h2>
          <span>
            {data.people.length} people · You’re {data.member.name}
          </span>
        </div>
        <button
          className="primary"
          onClick={() => openCheckin(data.member.person_id)}
          disabled={!data.member.person_id}
        >
          Check in
        </button>
        <button
          className="copy-invite"
          aria-live="polite"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              // Pass a promise while the gesture is active: Safari requires this.
              const link = request<{ invite: string }>("/invite", {}).then(
                (r) => invitationLink(r.invite),
              );
              if (
                typeof ClipboardItem !== "undefined" &&
                navigator.clipboard?.write
              ) {
                await navigator.clipboard.write([
                  new ClipboardItem({
                    "text/plain": link.then(
                      (text) => new Blob([text], { type: "text/plain" }),
                    ),
                  }),
                ]);
              } else {
                await navigator.clipboard.writeText(await link);
              }
              setCopied(true);
            })
          }
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied!" : "Copy invite link"}
        </button>
        <button
          onClick={() => {
            setSettings({
              name: data.group.name,
              meetingPoint: data.group.meeting_point,
            });
            setEdit(!edit);
          }}
        >
          Manage
        </button>
      </div>
      <div className="circle-content">
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {offline && (
          <p className="offline-notice">
            <WifiOff size={16} />
            Offline or unavailable. Last saved updates shown.
          </p>
        )}
        {edit && (
          <div className="circle-settings">
            {data.member.role === "owner" && (
              <form
                className="settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await request("/settings", settings, "PATCH");
                    onRename(settings.name);
                    await refresh();
                    setEdit(false);
                  });
                }}
              >
                <label>
                  Circle name
                  <input
                    required
                    value={settings.name}
                    maxLength={100}
                    onChange={(e) =>
                      setSettings({ ...settings, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Suggested meeting point (optional)
                  <input
                    value={settings.meetingPoint}
                    maxLength={200}
                    placeholder="Grandpa’s office"
                    onChange={(e) =>
                      setSettings({ ...settings, meetingPoint: e.target.value })
                    }
                  />
                </label>
                <small>
                  Just a suggestion. Each check-in can use a different place.
                </small>
                <button className="primary" disabled={busy}>
                  Save settings
                </button>
              </form>
            )}
            <button
              onClick={() =>
                void action(async () =>
                  setInvites(await request<InviteInfo[]>("/invites")),
                )
              }
            >
              Manage invitation links
            </button>
            {data.member.role === "owner" && (
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => setMembers(await request("/members")))
                }
              >
                Manage member access
              </button>
            )}
            {members && (
              <div className="invite-history">
                {members.map((m) => (
                  <div key={m.id}>
                    <span>
                      {m.name} · {m.revoked_at ? "access removed" : m.role}
                    </span>
                    {m.role !== "owner" && !m.revoked_at && (
                      <button
                        disabled={busy}
                        onClick={() => setRemoveMember(m.id)}
                      >
                        Remove access
                      </button>
                    )}
                  </div>
                ))}
                {removeMember && (
                  <div className="invite-box">
                    <p>
                      Remove {members.find((m) => m.id === removeMember)?.name}
                      ’s access? This also revokes all existing invitation
                      links. Shared check-in history stays. Copy a new link for
                      future invitations.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await request(
                            `/members/${removeMember}`,
                            undefined,
                            "DELETE",
                          );
                          setMembers(await request("/members"));
                          setInvites(null);
                          setRemoveMember(null);
                        })
                      }
                    >
                      Confirm removal
                    </button>
                    <button onClick={() => setRemoveMember(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await request("/my-locations", undefined, "DELETE");
                  await refresh();
                  setHistory(null);
                })
              }
            >
              Remove my shared locations
            </button>
            <button onClick={() => setForget(!forget)}>
              Remove circle from this device
            </button>
            {invites && (
              <div className="invite-history">
                {invites.map((i) => (
                  <div key={i.id}>
                    <span>
                      Created {dateTime(i.created_at)} ·{" "}
                      {i.revoked_at
                        ? "revoked"
                        : i.expires_at < Date.now()
                          ? "expired"
                          : `expires ${dateTime(i.expires_at)}`}
                    </span>
                    {!i.revoked_at && i.expires_at > Date.now() && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await request(
                              `/invites/${i.id}`,
                              undefined,
                              "DELETE",
                            );
                            setInvites(await request<InviteInfo[]>("/invites"));
                          })
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {forget && (
              <div className="invite-box">
                <p>
                  This removes saved access and pending check-ins from this
                  device. Shared history stays in the circle. You’ll need an
                  invitation to rejoin.
                </p>
                <button onClick={onForget}>Remove from this device</button>
                <button onClick={() => setForget(false)}>Keep circle</button>
              </div>
            )}
          </div>
        )}
        {queue.length > 0 && (
          <div className="pending">
            <b>{queue.length} updates pending—not shared yet</b>
            <button
              disabled={busy || offline}
              onClick={() =>
                void action(async () => {
                  for (const item of queue)
                    await request("/checkins", payload(item));
                  saveQueue([]);
                  await refresh();
                })
              }
            >
              Send pending
            </button>
            <button onClick={() => saveQueue([])}>Discard</button>
          </div>
        )}
        <div className="board-tabs">
          <button
            className={history === null ? "active" : ""}
            onClick={() => {
              setHistory(null);
            }}
          >
            Latest updates
          </button>
          <button
            className={history !== null ? "active" : ""}
            disabled={busy}
            onClick={() => {
              void loadHistory();
            }}
          >
            History
          </button>
          <button onClick={onShowMap}>Circle map</button>
        </div>
        {history === null ? (
          <>
            <div className="people-list">
              {data.people.map((p) => {
                const status = latest(p.id, "status");
                const presence = latest(p.id, "presence");
                return (
                  <article className="person" key={p.id}>
                    <div className="avatar">
                      {p.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="person-info">
                      <h3>
                        {p.name}
                        {p.id === data.member.person_id && (
                          <small> · you</small>
                        )}
                      </h3>
                      <span
                        className={
                          status && Date.now() - status.contacted_at < 86400000
                            ? status.value === "okay"
                              ? "okay-text"
                              : status.value === "help"
                                ? "help-text"
                                : "muted"
                            : "muted"
                        }
                      >
                        {describe(status)}
                        {status && (
                          <>
                            {" "}
                            ·{" "}
                            <time title={dateTime(status.contacted_at)}>
                              {ago(status.contacted_at)}
                            </time>
                          </>
                        )}
                      </span>
                      {status && (
                        <small>
                          Confirmed by {status.reporter_name}
                          {status.note && ` · ${status.note}`}
                        </small>
                      )}
                      {presence && (
                        <small>
                          <MapPin size={11} />
                          {describe(presence)} {presence.meeting_point} ·{" "}
                          {ago(presence.contacted_at)} ·{" "}
                          {presence.reporter_name}
                        </small>
                      )}
                    </div>
                    <button onClick={() => openCheckin(p.id)}>Check in</button>
                  </article>
                );
              })}
            </div>
            <form
              className="add-person"
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  await request("/people", { name: newPerson });
                  setNewPerson("");
                  await refresh();
                });
              }}
            >
              <input
                required
                aria-label="Add someone without the app"
                placeholder="Add someone without the app"
                value={newPerson}
                maxLength={100}
                onChange={(e) => setNewPerson(e.target.value)}
              />
              <button disabled={busy}>
                <Plus size={16} />
                Add
              </button>
            </form>
            <p className="privacy-note">
              Anyone in this circle can confirm someone they’ve reached. Names
              are supplied by members.
            </p>
          </>
        ) : (
          <div className="history">
            {!history.length && <p>No check-ins yet.</p>}
            {history.map((c) => (
              <p key={c.id}>
                <b>{data.people.find((p) => p.id === c.person_id)?.name}</b> ·{" "}
                {describe(c)}
                {c.meeting_point && ` · ${c.meeting_point}`}
                <br />
                <small>
                  {dateTime(c.contacted_at)} · confirmed by {c.reporter_name}
                  {c.note && ` · ${c.note}`}
                  {c.context && ` · ${c.context}`}
                  {c.located_at && " · Location snapshot shared"}
                </small>
              </p>
            ))}
            {cursor && (
              <button disabled={busy} onClick={() => void loadHistory(true)}>
                Earlier check-ins
              </button>
            )}
          </div>
        )}
      </div>
      {selected && (
        <div
          className="modal-backdrop"
          onClick={() => !busy && setSelected("")}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkin-title"
            className="checkin-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setSelected("")}
            >
              <ArrowLeft size={15} />
              Back
            </button>
            <h2 id="checkin-title">
              {selected === data.member.person_id
                ? "Your check-in"
                : `Check on ${data.people.find((p) => p.id === selected)?.name}`}
            </h2>
            <p>Confirmed by {data.member.name} · now</p>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <label>
              Note (optional)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  selected === data.member.person_id
                    ? "At home, all good…"
                    : "Spoke by phone, with me…"
                }
                maxLength={500}
              />
            </label>
            {selected === data.member.person_id && (
              <label className="location-consent">
                <input
                  type="checkbox"
                  checked={includeLocation}
                  onChange={(e) => setIncludeLocation(e.target.checked)}
                />
                <span>
                  Share my location with this circle for this check-in
                  <small>
                    A one-time snapshot, visible to members. Never live
                    tracking.
                  </small>
                </span>
              </label>
            )}
            <div className="status-options">
              <button
                disabled={busy}
                onClick={() => void checkin("status", "okay")}
              >
                <Check size={18} />
                {selected === data.member.person_id
                  ? "I’m okay"
                  : "Reported okay"}
              </button>
              <button
                disabled={busy}
                onClick={() => void checkin("status", "help")}
              >
                Needs help
              </button>
              <button
                disabled={busy}
                onClick={() => void checkin("status", "unknown")}
              >
                Not confirmed
              </button>
            </div>
            <details className="presence-options">
              <summary>Arrival or departure</summary>
              <label>
                Place
                <input
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                  placeholder="Grandpa’s office, home…"
                  maxLength={200}
                />
              </label>
              <div className="status-options">
                <button
                  disabled={busy || !place.trim()}
                  onClick={() => void checkin("presence", "arrived")}
                >
                  Arrived
                </button>
                <button
                  disabled={busy || !place.trim()}
                  onClick={() => void checkin("presence", "left")}
                >
                  Left
                </button>
              </div>
            </details>
            {offline && (
              <small>This will stay pending until you send it online.</small>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
