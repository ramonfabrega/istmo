import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CirclePin, CircleLayer } from "./Globe";
import type { CircleSession } from "./circles";
import type { Family } from "../shared/types";
import { api, dateTime } from "./api";
export default function CircleMap({
  session,
  onClose,
  children,
}: {
  session: CircleSession | null;
  onClose: () => void;
  children: (layer: CircleLayer | undefined) => ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<{ id: string; data: Family } | null>(
    null,
  );
  const data = snapshot?.id === session?.id ? snapshot?.data : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = <T,>(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) =>
    api<T>(`/api/family${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  useEffect(() => {
    setSelected(null);
    setDraft(null);
    setPicking(false);
    setError("");
    if (!session) return;
    let active = true;
    const refresh = async () => {
      try {
        const next = await request<Family>("");
        if (active) {
          setSnapshot({ id: session.id, data: next });
          setError("");
        }
      } catch {
        if (active)
          setError(
            "Circle unavailable. Any visible positions are last received snapshots.",
          );
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session?.id, session?.token]);
  const mutate = async (path: string, body?: unknown, method?: string) => {
    setBusy(true);
    setError("");
    try {
      await request(path, body, method);
      const next = await request<Family>("");
      setSnapshot({ id: session!.id, data: next });
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const onPlace = (name: string, latitude: number, longitude: number) =>
    mutate("/places", { name, latitude, longitude });
  const onRemove = (id: string) => mutate(`/places/${id}`, undefined, "DELETE");
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<CirclePin | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const pins = useMemo(() => {
    if (!data) return [];
    const people: CirclePin[] = data.people.flatMap((person) => {
      const latest = data.checkins
        .filter((c) => c.person_id === person.id)
        .sort(
          (a, b) =>
            b.contacted_at - a.contacted_at || b.created_at - a.created_at,
        )[0];
      if (
        !latest ||
        latest.latitude === null ||
        latest.longitude === null ||
        !latest.located_at ||
        now - latest.located_at > 86400000
      )
        return [];
      return [
        {
          id: person.id,
          name: person.name,
          latitude: latest.latitude,
          longitude: latest.longitude,
          kind: "person" as const,
          detail: `Shared ${dateTime(latest.located_at)} · accuracy ±${Math.round(latest.accuracy || 0)} m`,
        },
      ];
    });
    return [
      ...people,
      ...(data.places || []).map((p) => ({
        ...p,
        kind: "place" as const,
        detail: "Gathering spot",
      })),
    ];
  }, [data, now]);
  const layer: CircleLayer | undefined = session
    ? {
        id: session.id,
        pins,
        picking,
        onDismiss: () => {
          setSelected(null);
          setDraft(null);
          setPicking(false);
        },
        onPick: (latitude, longitude) => {
          setDraft({ latitude, longitude });
          setPicking(false);
          setSelected(null);
        },
        onSelect: setSelected,
      }
    : undefined;
  return (
    <div className="main-map-frame">
      {children(layer)}
      {session && (
        <>
          <div className="circle-map-toolbar">
            <span>
              <b>{session.name}</b>
              <small>
                {pins.filter((p) => p.kind === "person").length} shared
                positions · last 24h
              </small>
            </span>
            <button
              onClick={() => {
                setPicking(!picking && !draft);
                setDraft(null);
                setSelected(null);
              }}
            >
              {picking || draft ? "Cancel" : "Add gathering spot"}
            </button>
            <button onClick={onClose} aria-label="Close circle map">
              Earthquakes ×
            </button>
          </div>
          {error && (
            <p className="circle-overlay-notice" role="status">
              {error}
            </p>
          )}
          {!data && !error && (
            <p className="circle-overlay-notice">Loading circle…</p>
          )}
          {selected && data && (
            <div className="circle-pin-detail">
              <b>{selected.name}</b>
              <small>{selected.detail}</small>
              {selected.kind === "place" &&
                (data.member.role === "owner" ||
                  data.places.find((p) => p.id === selected.id)?.created_by ===
                    data.member.id) && (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (await onRemove(selected.id)) setSelected(null);
                    }}
                  >
                    Remove spot
                  </button>
                )}
              <button onClick={() => setSelected(null)}>Close</button>
            </div>
          )}
          {draft && (
            <form
              className="gathering-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!(await onPlace(name, draft.latitude, draft.longitude)))
                  return;
                setDraft(null);
                setPicking(false);
                setName("");
              }}
            >
              <label>
                Name this gathering spot
                <input
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder="Grandpa’s office"
                />
              </label>
              <small>
                {draft.latitude.toFixed(4)}°, {draft.longitude.toFixed(4)}° ·
                visible to this circle
              </small>
              <button className="primary" disabled={busy}>
                Save spot
              </button>
              <button type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </form>
          )}
          {!pins.length && !picking && (
            <p className="circle-map-empty">
              Share a location when checking in, or add a gathering spot.
            </p>
          )}
        </>
      )}
    </div>
  );
}
